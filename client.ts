import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import {CallFunction, ClientInfo, GetClients, GetClientDetails, 
    HeartBeat, Hello, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { ClientPort, ServerPort, MessageParser, ReqestIdGenerator } from "./common"
import { UUID, randomInt, randomUUID } from 'node:crypto';
import { freemem } from 'node:os';
import { createWriteStream, writeFile } from 'node:fs';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { Readline } from 'readline/promises';
import { exit } from 'node:process';

function randomNumber(min: number, max: number): number
{
    return randomInt(min, max);
}

function clientFreeMemory(): number
{
    return freemem();
}

function hddSpeed() : number
{
    const chunk = new Uint8Array(1000);
    let fileStream = createWriteStream('temp.bin');

    const tic = performance.now();

    for (let i = 0; i < 1000; ++i)
    {
        fileStream.write(chunk);
    }
    fileStream.end();
    
    const toc = performance.now();
    
    return toc - tic;
}

function checkFunctionSignture(functionName: string, args: any) : boolean
{
    if (functionName === 'randomNumber') 
    {
        return args.size === 2 && !Number.isNaN(Number(args[0])) && !Number.isNaN(Number(args[1]));
    }

    if (functionName === 'clientFreeMemory' ||
        functionName === 'hddSpeed') 
    {
        return args === null || args === undefined;
    }

    return false;
}

class Client 
{
    private readonly uuid : UUID;
    private readonly socket: dgram.Socket;
    private readonly requesIdGenerator = new ReqestIdGenerator();
    private requests = new Map<number, MessageInfo>();
    private readonly messageParser = new MessageParser();
    private readonly allowedMessages : MessageType[] = 
    [
        MessageType.GET_CLIENT_DETAILS,
        MessageType.CALL_FUNCTION,
        MessageType.REQUEST_ERROR,
        MessageType.RESULT_ERROR,
        MessageType.RESULT_OK
    ];
    private readonly serverPort = ServerPort;
    private readonly helloTimeout = 20000;
    private readonly heartbeatTimeout = 15000;
    private isServerOnline = false;
    private readonly availableFunctions = ["randomNumber, clientFreeMemory, hddSpeed"];

    private getHelloMessage(): Hello
    {
        return {type: MessageType.HELLO, 
                requestId: this.requesIdGenerator.next(), 
                data: {capacities: this.availableFunctions, id: this.uuid}}
    }

    private getHearbeatMessage(): HeartBeat
    {
        return {type: MessageType.HEARTBEAT, requestId: this.requesIdGenerator.next(), data: null};
    }

    private sendHello()
    {
        const msg = this.getHelloMessage();
        const message = Buffer.from(JSON.stringify(msg));
        const sendHelloCallBack = () =>
        {
            this.socket.send(message, this.serverPort);
            console.log("client: ", this.uuid, " sent message: ", msg);
        }

        const timer = setTimeout(sendHelloCallBack, 0);
        this.requests.set(msg.requestId, {msg: msg, timer: timer});
        
        //check response timer
        setTimeout(() =>
        {
            if (!this.isServerOnline)
            {
                clearTimeout(timer);
                const intervalTimer = setInterval(sendHelloCallBack, this.helloTimeout);
                this.requests.delete(msg.requestId);
                this.requests.set(msg.requestId, {msg: msg, timer: intervalTimer});
            }
            else
            {
                console.log("Server is online!");
            }
        }, 2000);
    }

    private sendHeartBeat()
    {
        const msg = this.getHearbeatMessage();
        const message = Buffer.from(JSON.stringify(msg));
        const timer = setInterval(() => 
        {
            this.socket.send(message, this.serverPort);
            console.log("client: ", this.uuid, " sent message: ", msg);
        }, this.heartbeatTimeout);

        this.requests.set(msg.requestId, {msg: msg, timer: timer});   

        //check response timer
        setTimeout(() =>
        {
            // send hello again if server got offline
            clearInterval(timer);
            this.isServerOnline = false;            
            this.requests.delete(msg.requestId);
            this.sendHello(); 
            
        }, 2000);
    }

    private checkMessageConsistency(serverMessage: Message) : MessageInfo
    {
        const clientMessageInfo = this.requests.get(serverMessage.requestId);
        if (clientMessageInfo === undefined)
        {
            throw Error("Server message " + serverMessage + " came too late!");
        }

        if (clientMessageInfo.msg.requestId !== serverMessage.requestId)
        {
            throw Error("Corrupted server message!");
        }

        if (!(clientMessageInfo.msg.type === MessageType.HELLO ||
              clientMessageInfo.msg.type === MessageType.HEARTBEAT ||
              clientMessageInfo.msg.type === MessageType.GET_CLIENTS))
        {
            throw Error("Wrong server message type!");
        }

        return clientMessageInfo;
    }

    private async prepareResponse(serverMessage: Message) : Promise<Message | null>
    {
        let result = null;

        try
        {
            const clientMessageInfo = this.checkMessageConsistency(serverMessage);

            if (serverMessage.type === MessageType.RESULT_OK)
            {   
                if (clientMessageInfo.msg.type === MessageType.HELLO)
                {
                    this.isServerOnline = true;
                    this.sendHeartBeat();
                    this.requests.delete(serverMessage.requestId);
                }            
                else if (clientMessageInfo.msg.type === MessageType.HEARTBEAT)
                {
                    //continue to send heartbeat message by protocol
                }
                else if (clientMessageInfo.msg.type === MessageType.GET_CLIENTS)
                {
                    console.log("Available clients on-line: ", serverMessage.data);
                    this.requests.delete(serverMessage.requestId);
                }
                else
                {
                    //skip other message types
                }
            }
            else if (serverMessage.type === MessageType.RESULT_ERROR)
            {   
                const msg = serverMessage as ResultError;
                console.error("Server sent error result for request: ", msg.requestId,". ", msg.data.description);
                this.requests.delete(serverMessage.requestId);
            }
            else if (serverMessage.type === MessageType.REQUEST_ERROR)
            {   
                const msg = serverMessage as RequestError;                
                console.error("Server sent request error for request: ", msg.requestId,". ", msg.data.description);
                this.requests.delete(serverMessage.requestId);
            }
            else if (serverMessage.type === MessageType.GET_CLIENT_DETAILS)
            {
                console.log("Client recieved GET_CLIENT_DETAILS request: ", serverMessage);
                result = { type: MessageType.RESULT_OK, 
                           requestId: serverMessage.requestId,
                           data: {capacities: this.availableFunctions, id: this.uuid} }
            }
            else if (serverMessage.type === MessageType.CALL_FUNCTION)
            {
                console.log("Client recieved CALL_FUNCTION request: ", serverMessage);
                
                const msg = serverMessage as CallFunction;        
                if (checkFunctionSignture(msg.data.name, msg.data.functionArgs))
                {
                    let res: number = 0;
                    if (msg.data.name === 'randomNumber') 
                    {
                        res = randomNumber(Number(msg.data.functionArgs[0]), Number(msg.data.functionArgs[1]));
                    }
                    else if (msg.data.name === 'clientFreeMemory') 
                    {
                        res = clientFreeMemory();
                    }
                    else
                    {
                        res = hddSpeed();
                    }
                    
                    result = { type: MessageType.RESULT_OK, 
                               requestId: serverMessage.requestId,
                               data: res }                
                }
                else 
                {
                    result = { type: MessageType.RESULT_ERROR, 
                               requestId: serverMessage.requestId,
                               data: null }
                }            
            }
        }
        catch(error)
        {
            result = { type: MessageType.REQUEST_ERROR, 
                       requestId: serverMessage.requestId,
                       data: {description: (error as Error).message} }
        }

        return result;
    }

    constructor()
    {
        this.socket = dgram.createSocket('udp4');
        this.uuid = randomUUID();

        this.socket.on('error', (err) => {
            console.error(`client error:\n${err.stack}`);
            this.socket.close();
        });

        this.socket.on('listening', () => {
            this.socket.setBroadcast(true);
            const address = this.socket.address();
            console.log(`client listening ${address.address}:${address.port}`);

            this.sendHello();
        });

        this.socket.on('message', async (msg, rinfo) => {
            console.log(`client got: ${msg} from ${rinfo.address}:${rinfo.port}`);

            const message = this.messageParser.parse(msg, this.allowedMessages);
            this.prepareResponse(message).then((response) =>
            {
                if (response !== null)
                {
                    this.socket.send(Buffer.from(JSON.stringify(response)), this.serverPort);
                }
            })
        });
    }
    
    public run(): void 
    {
        setTimeout(() => 
        {
            console.log("Launched client!");
            this.socket.bind(ClientPort);
        });
    }

    public sendGetClients()
    {
        setInterval(() =>{
            const message : GetClients = 
            {
                type: MessageType.GET_CLIENTS,
                requestId: this.requesIdGenerator.next(),
                data: null
            };
            this.socket.send(Buffer.from(JSON.stringify(message)), this.serverPort);
            const timer = setTimeout(() =>
            {
                console.error("No response from server for request: ", message.requestId);
                this.requests.delete(message.requestId);
            }, 2000)

            this.requests.set(message.requestId, {msg: message, timer: timer});
        }
        , 5000);
    }

    public exit()
    {
        this.socket.close();
    }
}

console.log(randomNumber(5, 20));
console.log(clientFreeMemory());
console.log(hddSpeed());

const client = new Client();
client.run();
client.sendGetClients();

// setTimeout(() =>
// {
//     const readlineSync = require('readline-sync');
//     readlineSync.promptCLLoop({
//         get: () => { 
//             client.sendGetClients();
//         },
//         quit: () => { 
//             client.exit();
//             return true; 
//         }
//     });
// });
