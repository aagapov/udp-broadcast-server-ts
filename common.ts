import { Buffer } from 'node:buffer';
import { CallFunction, ClientInfo, GetClients, GetClientDetails, 
        HeartBeat, Hello, Message, MessageType, RequestError, ResultError, ResultOk } from './protocol';

export const ServerPort = 41234;
export const HelloTimeout = 20000;
export const HeartBeatTimeout = 15000;
export const ResolveRequestTimeout = 5000;
export const AllowedFunctions = ['randomNumber', 'clientFreeMemory', 'hddSpeed'];

export class MessageParser
{
    parse(buffer: Buffer, allowedMessages: MessageType[]) : Message
    {
        let result: Message = {type: MessageType.RESULT_ERROR, 
                               requestId: -1,
                               data: {description: "Failed to parse message from server: "}};

        try
        {
            const message = JSON.parse(buffer.toString()) as Message;

            if (!allowedMessages.includes(message.type))
            {
                throw Error('It is not allowed to process messages of type: ' + message.type);
            }
            
            switch(message.type)
            {
                case MessageType.CALL_FUNCTION:
                {
                    result = message as CallFunction;
                    break;
                }
                case MessageType.GET_CLIENTS:
                {
                    result = message as GetClients;
                    break;
                }
                case MessageType.GET_CLIENT_DETAILS:
                {
                    result = message as GetClientDetails;
                    break;
                }
                case MessageType.HEARTBEAT:
                {
                    result = message as HeartBeat;
                    break;
                }
                case MessageType.HELLO:
                {
                    result = message as Hello;
                    break;
                }
                case MessageType.REQUEST_ERROR:
                {
                    result = message as RequestError;
                    break;
                } 
                case MessageType.RESULT_ERROR:
                {
                    result = message as ResultError;
                    break;
                }    
                case MessageType.RESULT_OK:
                {
                    result = message as ResultOk;
                    break;
                }
            }
        }
        catch(ex)
        {
            result.data.description += ex;
        }       
        return result;
    }
}

export class ReqestIdGenerator
{
    public id: number = 0;

    next(): number
    {
        return this.id++;
    }
}