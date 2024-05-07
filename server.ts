import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { CallFunction, ClientInfo, GetClients, GetClientDetails, 
         HeartBeat, Hello, IDeferred, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { HeartBeatTimeout, MessageParser, ReqestIdGenerator, ResolveRequestTimeout, ServerPort } from './common'
import { UUID, createHash } from 'node:crypto';

export type ClientRecord = 
{
    info: ClientInfo;
    port: number;
    lastUpdateTime: number;
}

export class Server 
{
    private socket: dgram.Socket;
    private readonly requesIdGenerator = new ReqestIdGenerator();
    public requests = new Map<number, MessageInfo>(); // here we store all pending requests
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
    public readonly clients = new Map<UUID, ClientRecord>(); // here we store all clients on-line
    private checkClientsOnlineTimer: NodeJS.Timeout;
    private readonly httpPort = process.env.PORT || 3000;

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
                const allClientsData : {capacities: string[]}[] = [];
                [...this.clients.values()].forEach((x) => allClientsData.push({capacities: x.info.capacities}));

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
                            if (msgInfo.result !== undefined)
                            {
                                msgInfo.result.resolve(clientMessage.data);
                                this.requests.delete(clientMessage.requestId);
                            }
                            else
                            {
                                throw Error(`Failed to find request id = ${clientMessage.requestId} in cache`);
                            }
                        }
                    }            
                    else if (serverMessageInfo.msg.type === MessageType.CALL_FUNCTION)
                    {
                        const msgInfo = this.requests.get(clientMessage.requestId);
                        if (msgInfo !== undefined)
                        {
                            clearTimeout(msgInfo.timer);
                            if (msgInfo.result !== undefined)
                            {
                                msgInfo.result.resolve(clientMessage.data.result);
                                this.requests.delete(clientMessage.requestId);
                            }
                            else
                            {
                                throw Error(`Failed to find request id = ${clientMessage.requestId} in cache`);
                            }
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
                            msgInfo.result?.resolve(undefined);
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
                            msgInfo.result?.resolve(undefined);
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
     * Sends GET_CLIENT_DETAILS request to the client
     * @param clientId client UUID
     */
    public async sendGetClientDetails(clientId: UUID): Promise<number | ClientInfo | undefined>
    {
        const clientRecord = this.clients.get(clientId)
        if (clientRecord !== undefined)
        {
            console.log("Client ", clientId, " is online")
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

            //Register promise with future result in cache. It will be resolved later after client response            
            let resolveHandler: IDeferred<number | ClientInfo | undefined>['resolve'] = (value) => { console.log(value) };
            const resultPromise: IDeferred<number | ClientInfo | undefined>['promise'] = new Promise((resolve) => 
            {
                resolveHandler = resolve;
            })
            this.requests.set(message.requestId, {msg: message, 
                                                  timer: timer, 
                                                  result: {promise: resultPromise, 
                                                           resolve: resolveHandler}});

            console.log("Wait for request id ", message.requestId);
            return resultPromise;    
        }
        
        console.error("There is no such client with id: ", clientId);
        return undefined;
    }

    /**
     * Sends CALL_FUNCTION request
     * @param clientId client UUID
     * @param functionName name of the function to call
     * @param args function arguments
     */
    public async callFunction(clientId: UUID, functionName: string, args?: any) :  Promise<number | ClientInfo | undefined>
    {
        const clientRecord = this.clients.get(clientId);

        if(clientRecord !== undefined)
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

            //Register promise with future result in cache. It will be resolved later after client response  
            let resolveHandler: IDeferred<number | ClientInfo | undefined>['resolve'] = (value) => { console.log(value) };
            const resultPromise: IDeferred<number | ClientInfo | undefined>['promise'] = new Promise((resolve) => 
            {
                resolveHandler = resolve;
            })
            this.requests.set(message.requestId, {msg: message, 
                                                  timer: timer, 
                                                  result: {promise: resultPromise, 
                                                           resolve: resolveHandler}});
            return resultPromise;
        }
        console.error("There is no such client with id: ", clientId);
        return undefined;
    }

    constructor()
    {
        this.socket = dgram.createSocket('udp4');

        this.socket.on('error', (err) => 
        {
            console.error(`server error:\n${err.stack}`);
            this.socket.close();
        });
        
        this.socket.on('message', async (msg, rinfo) => 
        {
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
            [...this.clients.values()].forEach((client) => 
            {
                if ((Date.now() - client.lastUpdateTime) > HeartBeatTimeout)
                {
                    console.log("Client ", client.info.id, " got offline!");
                    this.clients.delete(client.info.id);
                }
            });
        }, 5000);
    }

    public async run()
    {
        console.log('Server has been started!');
        this.socket.bind(ServerPort);
    }
}