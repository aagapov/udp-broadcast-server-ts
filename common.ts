import * as dgram from "node:dgram";
import { Buffer } from 'node:buffer';
import { CallFunction, ClientInfo, ClientResponse, GetClients, GetClientDetails, 
        HeartBeat, Hello, MessageType, RequestError, ResultError, ResultOk } from './protocol';

export const ServerPort = 41234;
export const ClientPort = 5555;

export function sendHello(socket: dgram.Socket, port: number, clientInfo?: ClientInfo)
{
    const hello : Hello =
    {
        type: MessageType.HELLO,        
        data: (clientInfo === undefined) ? null : clientInfo
    };
    const message = Buffer.from(JSON.stringify(hello));
    socket.send(message, port);
}