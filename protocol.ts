import { UUID } from "crypto"

enum MessageType 
{
    CALL_FUNCTION = 'CALL_FUNCTION',
    GET_CLIENT_DETAILS = 'GET_CLIENT_DETAILS',
    GET_CLIENTS = 'GET_CLIENTS',
    HEARTBEAT = 'HEARTBEAT',
    HELLO = 'HELLO',
    REQUEST_ERROR = 'REQUEST_ERROR', 
    RESULT_ERROR = 'RESULT_ERROR',
    RESULT_OK   = 'RESULT_OK',    
}

type Message =
{
    type: MessageType;
    requestId: number;
    data?: any
}

type RequestError = Message & 
{
    type: MessageType.REQUEST_ERROR;
    data: {description: string};
}

type ResultError = Message &
{
    type: MessageType.RESULT_ERROR;
    data: {description: string};
}

type ResultOk = Message & 
{
    type: MessageType.RESULT_OK;
}

type ClientInfo = 
{
    capacities: string[];
    id: UUID;
    //icon: ImageData
}

type Hello = Message & 
{
    type: MessageType.HELLO;
    data: ClientInfo | null;
}

type GetClients = Message & 
{
    type: MessageType.GET_CLIENTS;
    data: null
}

type HeartBeat = Message & 
{
    type: MessageType.HEARTBEAT;
    data: {id: UUID}
}

type GetClientDetails = Message & 
{
    type: MessageType.GET_CLIENT_DETAILS;
    data: null;
}

type CallFunction = Message & 
{
    type: MessageType.CALL_FUNCTION;
    data: { 
        name: string; functionArgs: any;
    }
}

type MessageInfo = 
{
    msg: Message; 
    timer: NodeJS.Timeout;
}

export {CallFunction, ClientInfo, 
        GetClients, GetClientDetails, HeartBeat, 
        Hello, Message, MessageInfo, MessageType, RequestError, ResultError, ResultOk };

