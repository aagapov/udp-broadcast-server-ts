import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import {CallFunction, ClientInfo, GetClients, GetClientDetails, 
    HeartBeat, Hello, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { HeartBeatTimeout, HelloTimeout, ServerPort, MessageParser, ReqestIdGenerator } from "./common"
import { UUID, randomInt, randomUUID } from 'node:crypto';
import { freemem } from 'node:os';
import { createWriteStream } from 'node:fs';
import { performance } from 'node:perf_hooks';

/**
 * @returns random naumbe in range [min, max]
 */
function randomNumber(min: number, max: number): number
{
    return randomInt(min, max);
}
/**
  * @returns amount of free RAM 
  */
function clientFreeMemory(): number
{
    return freemem();
}
/**
 * Measures time of writing 1MB of zeros on HDD
 * @returns measuresd time 
 */
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

/**
 * Checks if function was called with right arguments
 * @returns true if server is on-line, otherwise false
 */
function checkFunctionSignture(functionName: string, args: any) : boolean
{
    if (functionName === 'randomNumber') 
    {
        const array = args as number[];
        return array.length === 2 && !Number.isNaN(Number(args[0])) && !Number.isNaN(Number(args[1]));
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
    private readonly clientPort = randomNumber(1000, 5000);
    private readonly helloTimeout = HelloTimeout;
    private readonly heartbeatTimeout = HeartBeatTimeout;
    private readonly availableFunctions = ["randomNumber, clientFreeMemory, hddSpeed"];
    private lastHeartBeatTimeStamp = 0;
   
    /**
     * Checks if server is on-line
     * @returns true if server is on-line, otherwise false
     */
    public isServerOnline(): boolean
    {
        return Date.now() - this.lastHeartBeatTimeStamp < this.heartbeatTimeout;
    }

    /**
     * Generates HELLO message
     * @returns message of MessageType.Hello
     */
    private getHelloMessage(): Hello
    {
        return {type: MessageType.HELLO, 
                requestId: this.requesIdGenerator.next(), 
                data: {capacities: this.availableFunctions, id: this.uuid}}
    }

    private getHearbeatMessage(): HeartBeat
    {
        return {type: MessageType.HEARTBEAT, requestId: this.requesIdGenerator.next(), data: { id: this.uuid }};
    }

    /**
     * Periodically sends HELLO message
     */
    private sendHello()
    {
        const msg = this.getHelloMessage();
        const message = Buffer.from(JSON.stringify(msg));
        const sendHelloCallBack = () =>
        {
            this.socket.send(message, this.serverPort);
            console.log("client: ", this.uuid, " sent HELLO message: ", msg);           
        }

        const oneShotTimer = setTimeout(sendHelloCallBack, 0);
        this.requests.set(msg.requestId, {msg: msg, timer: oneShotTimer});

         //check response timer
        setTimeout(() =>
        {
            // If we have not recieved response for the first HELLO message
            // replace one-shot timer by interval timer
            if (!this.isServerOnline())
            {
                clearTimeout(oneShotTimer);
                const intervalTimer = setInterval(sendHelloCallBack, this.helloTimeout);
                this.requests.set(msg.requestId, {msg: msg, timer: intervalTimer});
            }             
        }, 2000);
    }

    /**
     * Periodically sends HEARTBEAT request
     */
    private sendHeartBeat()
    {
        const msg = this.getHearbeatMessage();
        const message = Buffer.from(JSON.stringify(msg));
        const timer = setInterval(() => 
        {
            this.socket.send(message, this.serverPort);
            console.log("client: ", this.uuid, " sent HEARTBEAT message: ", msg);
            //check response timer
            setTimeout(() =>
            {
                //Check if server sent response for hello message.
                if (!this.isServerOnline())
                {
                    console.log("Server got offline!");
                    // send hello again if server got offline
                    clearInterval(timer);
                    this.requests.delete(msg.requestId);
                    this.sendHello(); 
                }
            }, 2000);
        }, this.heartbeatTimeout);

        this.requests.set(msg.requestId, {msg: msg, timer: timer});          
    }

    /**
     * Checks if there is appropriate mapping between client request and server response.
     * Also checks that response has appropriate type
     * @param message server response message
     * @throws Error object in case of any insconsistency
     * @returns client message data which is mapped to the server response
     */
    private checkMessageConsistency(serverMessage: Message) : MessageInfo
    {
        const clientMessageInfo = this.requests.get(serverMessage.requestId);
        if (clientMessageInfo === undefined)
        {
            throw Error("Server message of type: " + serverMessage.type + " with requestId: " + serverMessage.requestId + " came too late!");
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

    /**
     * Prepares client response for the current server message.
     * @param message server message
     * @returns client response message or null if no response required
     */
    private async prepareResponse(serverMessage: Message) : Promise<Message | null>
    {
        let result = null;

        try
        {
            if (serverMessage.type === MessageType.GET_CLIENT_DETAILS)
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
                               data: {description: "Wrong call signature for function " + msg.data.name}}
                }            
            }
            else 
            {
                const clientMessageInfo = this.checkMessageConsistency(serverMessage);

                if (serverMessage.type === MessageType.RESULT_OK)
                {   
                    if (clientMessageInfo.msg.type === MessageType.HELLO)
                    {
                        console.log('Server got on-line!');
                        this.lastHeartBeatTimeStamp = Date.now();
                        const helloRequest = this.requests.get(serverMessage.requestId);
                        if (helloRequest !== undefined)
                        {
                            clearInterval(helloRequest.timer);
                            this.requests.delete(serverMessage.requestId);
                        }                        
                        this.sendHeartBeat();                       
                    }            
                    else if (clientMessageInfo.msg.type === MessageType.HEARTBEAT)
                    {
                        this.lastHeartBeatTimeStamp = Date.now();
                    }
                    else if (clientMessageInfo.msg.type === MessageType.GET_CLIENTS)
                    {
                        const clientsInfo = serverMessage.data as {id: UUID; capacities: string[]}[];
                        console.log("Available clients on-line:\n", clientsInfo);                        
                        
                        const msg = this.requests.get(serverMessage.requestId)
                        if (msg !== undefined)
                        {
                            clearTimeout(msg.timer);
                            this.requests.delete(serverMessage.requestId);
                        }                        
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
            try 
            {
                const message = this.messageParser.parse(msg, this.allowedMessages);
                this.prepareResponse(message).then((response) =>
                {
                    if (response !== null)
                    {
                        if (response.type !== MessageType.REQUEST_ERROR)
                        {
                            this.socket.send(Buffer.from(JSON.stringify(response)), this.serverPort);
                        }
                        else
                        {
                            console.error((response as RequestError).data.description)
                        }
                    }
                })
            }
            catch(error)
            {
                console.error((error as Error).message);
            }
        });
    }
    
    public run(): void 
    {
        setTimeout(() => 
        {
            console.log("Launched client!");
            this.socket.bind(this.clientPort);
        });
    }
    /**
     * Periodically sends GET_CLIENTS request just for testing
     */
    public sendGetClients()
    {
        setInterval(() =>
        {
            if (this.isServerOnline())
            {
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
        }, 60000);
    }
}

const client = new Client();
client.run();
client.sendGetClients();