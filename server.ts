import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { CallFunction, ClientInfo, GetClients, GetClientDetails, 
        HeartBeat, Hello, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { HeartBeatTimeout, MessageParser, ReqestIdGenerator, ServerPort } from './common'
import { UUID } from 'node:crypto';

type ClientRecord = 
{
    info: ClientInfo;
    port: number;
    lastUpdateTime: number;
}

class Server 
{
    private socket: dgram.Socket;
    private readonly requesIdGenerator = new ReqestIdGenerator();
    private requests = new Map<number, MessageInfo>(); // here we store all pending requests
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
    private clients = new Map<UUID, ClientRecord>(); // here we store all clients on-line
    private checkClientsOnlineTimer: NodeJS.Timeout;

    /**
     * Checks whether current client is on-line
     * @param clientId UUID of the client
     * @returns true if client is on-line otherwise false
     */
    private isClientOnline(clientId: UUID): boolean
    {
        return this.clients.has(clientId);
    }

    /**
     * Callback for send message error handling
     */
    private sendErrorCallback(msg: Message, error: Error | null) 
    {
        if (error !== null)
        {
            console.error("server FAILED to send message: ", error.message);
        }
        else 
        {
            console.log("server: sent message: ", msg);
        }
    }

    /**
     * Checks if there is appropriate mapping between server request and client response.
     * Also checks that response has appropriate type
     * @param message client response message
     * @throws Error object in case of any insconsistency
     * @returns server message data which is mapped to the client response
     */
    private checkMessageConsistency(clientMessage: Message) : MessageInfo
    {
        const serverMessageInfo = this.requests.get(clientMessage.requestId);
        if (serverMessageInfo === undefined)
        {
            throw Error("Client message of type: " + clientMessage.type + " with requestId: " + clientMessage.requestId + " came too late!");
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

    /**
     * Prepares server response for the current client message.
     * @param message client message
     * @param port client's port
     * @returns server response message or null if no response required
     */
    private async prepareResponse(clientMessage: Message, clientPort: number) : Promise<Message | null>
    {
        let result: Message | null = null;

        try
        {
            if (clientMessage.type === MessageType.HEARTBEAT)
            {
                console.log("Server received HEARTBEAT message ", clientMessage);
                const msg = clientMessage as HeartBeat;
                const clienRecord = this.clients.get(msg.data.id);
                if (clienRecord !== undefined)
                {
                    clienRecord.port = clientPort;
                    clienRecord.lastUpdateTime = Date.now();
                }
                result = 
                {
                    type: MessageType.RESULT_OK,
                    requestId: clientMessage.requestId,
                    data: null
                };
            }
            else if (clientMessage.type === MessageType.HELLO)
            {
                console.log("Server received HELLO message ", clientMessage);
                const msg = clientMessage as Hello;
                this.clients.set(msg.data.id, {info: msg.data, port: clientPort, lastUpdateTime: Date.now()});
                
                result = 
                {
                    type: MessageType.RESULT_OK,
                    requestId: clientMessage.requestId,
                    data: null
                };
            }
            else if (clientMessage.type === MessageType.GET_CLIENTS)
            { 
                console.log("Server received GET_CLIENTS message ", clientMessage);
                const allClientsData : ClientInfo[] = [];
                [...this.clients.values()].forEach((x) => allClientsData.push(x.info));

                result = 
                {
                    type: MessageType.RESULT_OK,
                    requestId: clientMessage.requestId,
                    data: allClientsData
                };
            }
            else 
            {
                const serverMessageInfo = this.checkMessageConsistency(clientMessage);

                if (clientMessage.type === MessageType.RESULT_OK)
                {   
                    console.log("Server received RESULT_OK message ", clientMessage);

                    if (serverMessageInfo.msg.type === MessageType.GET_CLIENT_DETAILS)
                    {
                        const msgInfo = this.requests.get(clientMessage.requestId);
                        if (msgInfo !== undefined)
                        {
                            clearTimeout(msgInfo.timer);
                            this.requests.delete(clientMessage.requestId);
                        }
                    }            
                    else if (serverMessageInfo.msg.type === MessageType.CALL_FUNCTION)
                    {
                        const msgInfo = this.requests.get(clientMessage.requestId);
                        if (msgInfo !== undefined)
                        {
                            clearTimeout(msgInfo.timer);
                            this.requests.delete(clientMessage.requestId);
                        }
                    }                
                    else
                    {
                        //skip other message types
                    }
                }
                else if (clientMessage.type === MessageType.RESULT_ERROR)
                {
                    console.error("Server received RESULT_ERROR message ", clientMessage);
                    if (serverMessageInfo.msg.type === MessageType.GET_CLIENT_DETAILS ||
                        serverMessageInfo.msg.type === MessageType.CALL_FUNCTION)
                    {
                        const msgInfo = this.requests.get(clientMessage.requestId);
                        if (msgInfo !== undefined)
                        {
                            clearTimeout(msgInfo.timer);
                            this.requests.delete(clientMessage.requestId);
                        }
                    }                
                    else
                    {
                        //skip other message types
                    }
                }
                else if (clientMessage.type === MessageType.REQUEST_ERROR)
                {  
                    console.error("Server received REQUEST_ERROR message ", clientMessage);
                    if (serverMessageInfo.msg.type === MessageType.GET_CLIENT_DETAILS ||
                        serverMessageInfo.msg.type === MessageType.CALL_FUNCTION)
                    {
                        const msgInfo = this.requests.get(clientMessage.requestId);
                        if (msgInfo !== undefined)
                        {
                            clearTimeout(msgInfo.timer);
                            this.requests.delete(clientMessage.requestId);
                        }
                    }                            
                    else
                    {
                        //skip other message types
                    }            
                }                
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

    /**
     * Periodically sends GET_CLIENT_DETAILS request just for testing
     */
    public sendGetClientDetails()
    {
        setInterval(() =>
        {
            if (this.clients.size === 0)
            {
                return;
            }

            this.clients.forEach((clientRecord) =>
            {
                const message : GetClientDetails = 
                {
                    type: MessageType.GET_CLIENT_DETAILS,
                    requestId: this.requesIdGenerator.next(),
                    data: null
                };

                this.socket.send(Buffer.from(JSON.stringify(message)), clientRecord.port, (error) => this.sendErrorCallback(message, error));
                const timer = setTimeout(() =>
                {
                    console.error("No response from client for request: ", message.requestId);
                    this.requests.delete(message.requestId);
                }, 2000);
    
                this.requests.set(message.requestId, {msg: message, timer: timer});
            });
        }, 30000)
    }

    /**
     * Periodically sends CALL_FUNCTION request just for testing
     * @param functionName name of the function to call
     * @param args function arguments
     */
    public sendCallFunction(functionName: string, args?: any)
    {
        setInterval(() =>
        {
            if (this.clients.size === 0)
            {
                return;
            }

            this.clients.forEach((clientRecord) =>
            {
                const message : CallFunction = 
                {
                    type: MessageType.CALL_FUNCTION,
                    requestId: this.requesIdGenerator.next(),
                    data: {name: functionName, functionArgs: args}
                };

                this.socket.send(Buffer.from(JSON.stringify(message)), clientRecord.port, (error) => this.sendErrorCallback(message, error));

                // Check if client respond to the request after 2000 ms.
                // If no response has arrived delete message from internal cache of messages
                const timer = setTimeout(() =>
                {
                    console.error("No response from client for request: ", message.requestId);
                    this.requests.delete(message.requestId);
                }, 2000);

                this.requests.set(message.requestId, {msg: message, timer: timer});
            })            
        }, 50000);
    }

    constructor()
    {
        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err) => {
            console.error(`server error:\n${err.stack}`);
            this.socket.close();
        });
        
        this.socket.on('message', (msg, rinfo) => {
            try 
            {
                const message = this.messageParser.parse(msg, this.allowedMessages);
                this.prepareResponse(message, rinfo.port).then((response) =>
                {
                    if (response !== null)
                    {
                        if (response.type !== MessageType.REQUEST_ERROR)
                        {
                            this.socket.send(Buffer.from(JSON.stringify(response)), rinfo.port, (error) => this.sendErrorCallback(response, error));
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
        
        this.socket.on('listening', () => {
            const address = this.socket.address();
            console.log(`server listening ${address.address}:${address.port}`);
        });
        
        this.checkClientsOnlineTimer = setInterval(() =>
        {
            [...this.clients.values()].forEach((x) => 
            {
                if ((Date.now() - x.lastUpdateTime) > HeartBeatTimeout)
                {
                    console.log("Client ", x.info.id, " got offline!");
                    this.clients.delete(x.info.id);
                }
            });
        }, 5000);
    }

    public run()
    {
        setTimeout(() =>
        {
            console.log('Server has been started!');
            this.socket.bind(ServerPort);
        }, 0);
    }
}

const server = new Server();
server.sendCallFunction("randomNumber", [0, 100]);
server.sendCallFunction("clientFreeMemory");
server.sendCallFunction("hddSpeed");
server.sendGetClientDetails();
server.run();
