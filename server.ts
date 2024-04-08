import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { CallFunction, ClientInfo, GetClients, GetClientDetails, 
        HeartBeat, Hello, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { MessageParser, ReqestIdGenerator, ServerPort } from './common'
import { UUID } from 'node:crypto';

type ClientRecord = 
{
    info: ClientInfo;
    port: number;
    lastHeartBeat: Date;
}

class Server 
{
    private socket: dgram.Socket;
    private readonly requesIdGenerator = new ReqestIdGenerator();
    private requests = new Map<number, MessageInfo>();
    private readonly messageParser = new MessageParser();
    private readonly allowedMessages : MessageType[] = 
    [
        MessageType.GET_CLIENTS,
        MessageType.HEARTBEAT,
        MessageType.HELLO,
        MessageType.REQUEST_ERROR,
        MessageType.RESULT_ERROR,
        MessageType.RESULT_OK
    ];
    private clients = new Map<UUID, ClientRecord>();

    private checkMessageConsistency(clientMessage: Message) : MessageInfo
    {
        const serverMessageInfo = this.requests.get(clientMessage.requestId);
        if (serverMessageInfo === undefined)
        {
            throw Error("Client message " + clientMessage + " came too late!");
        }

        if (serverMessageInfo.msg.requestId !== clientMessage.requestId)
        {
            throw Error("Corrupted client message!");
        }

        if (!(serverMessageInfo.msg.type === MessageType.GET_CLIENT_DETAILS ||
              serverMessageInfo.msg.type === MessageType.CALL_FUNCTION))
        {
            throw Error("Wrong client message type!");
        }

        return serverMessageInfo;
    }

    private async prepareResponse(clientMessage: Message) : Promise<Message | null>
    {
        
        let result = null;

        try
        {
            const clientMessageInfo = this.checkMessageConsistency(clientMessage);

            if (clientMessage.type === MessageType.RESULT_OK)
            {   
                if (clientMessageInfo.msg.type === MessageType.HELLO)
                {
                }            
                else if (clientMessageInfo.msg.type === MessageType.HEARTBEAT)
                {
                }
                else if (clientMessageInfo.msg.type === MessageType.GET_CLIENTS)
                {
                }
                else
                {
                    //skip other message types
                }
            }
            else if (clientMessage.type === MessageType.RESULT_ERROR)
            {  
            }
            else if (clientMessage.type === MessageType.REQUEST_ERROR)
            {               
            }
            else if (clientMessage.type === MessageType.GET_CLIENT_DETAILS)
            {              
            }
            else if (clientMessage.type === MessageType.CALL_FUNCTION)
            {                
            }
        }
        catch(error)
        {
            result = { type: MessageType.REQUEST_ERROR, 
                       requestId: clientMessage.requestId,
                       data: {description: (error as Error).message} }
        }

        return result;
    }

    constructor()
    {
        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err) => {
            console.error(`server error:\n${err.stack}`);
            this.socket.close();
        });
        
        this.socket.on('message', (msg, rinfo) => {
            console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
            const message = this.messageParser.parse(msg, this.allowedMessages);
            this.prepareResponse(message).then((response) =>
            {
                if (response !== null)
                {
                    this.socket.send(Buffer.from(JSON.stringify(response)), rinfo.port);
                }
            })

        });
        
        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`server listening ${address.address}:${address.port}`);
        });        
    }

    public run()
    {
        this.socket.bind(ServerPort);
    }
}

let server = new Server();
server.run();