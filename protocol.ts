import { UUID } from "crypto"

export enum MessageType 
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

export type Message =
{
    type: MessageType;
    requestId: number;
    data?: any
}

export type RequestError = Message & 
{
    type: MessageType.REQUEST_ERROR;
    data: {description: string};
}

export type ResultError = Message &
{
    type: MessageType.RESULT_ERROR;
    data: {description: string};
}

export type ResultOk = Message & 
{
    type: MessageType.RESULT_OK;
}

export type ClientInfo = 
{
    capacities: string[];
    id: UUID;
    icon: string;
}

export type Hello = Message & 
{
    type: MessageType.HELLO;
    data: ClientInfo | null;
}

export type GetClients = Message & 
{
    type: MessageType.GET_CLIENTS;
    data: null
}

export type HeartBeat = Message & 
{
    type: MessageType.HEARTBEAT;
    data: {id: UUID}
}

export type GetClientDetails = Message & 
{
    type: MessageType.GET_CLIENT_DETAILS;
    data: null;
}

export type CallFunction = Message & 
{
    type: MessageType.CALL_FUNCTION;
    data: { 
        name: string; functionArgs: any;
    }
}

// Promise with external resolve function
export interface IDeferred<T> 
{
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
}

export type MessageInfo = 
{
    msg: Message; 
    timer: NodeJS.Timeout;
    result?: IDeferred<undefined | number | ClientInfo>    
}