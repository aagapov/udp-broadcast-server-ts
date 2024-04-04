import { UUID } from "crypto"

enum MessageType {
    'CALL_FUNCTION',
    'CLIENT_RESPONSE',
    'GET_CLIENT_DETAILS',
    'GET_CLIENTS',
    'HEARTBEAT',
    'HELLO',
    'REQUEST_ERROR', 
    'RESULT_ERROR',
    'RESULT_OK',    
}

type RequestError = 
{
    type: MessageType.REQUEST_ERROR;
    data: {description?: string}
}

type ResultError = 
{
    type: MessageType.RESULT_ERROR;
    data: {description?: string}
}

type ResultOk = 
{
    type: MessageType.RESULT_OK;
    data?: any;
}

type ClientInfo = {
    capacities: string[];
    id: UUID;
    //icon: ImageData
}

type Hello = 
{
    type: MessageType.HELLO;
    data: ClientInfo | null;
}

type GetClients = 
{
    type: MessageType.GET_CLIENTS;
    data: {
        capacities?: string[];
    }
}

type ClientResponse = 
{
    type: MessageType.CLIENT_RESPONSE;
    data: ClientInfo;
}

type HeartBeat = 
{
    type: MessageType.HEARTBEAT;
}

type GetClientDetails = 
{
    type: MessageType.GET_CLIENT_DETAILS;
    data: ClientInfo;
}

type CallFunction = {
    type: MessageType.CALL_FUNCTION;
    data: { 
        name: string; functionArgs: any;
    }
}

export {CallFunction, ClientInfo, ClientResponse, 
        GetClients, GetClientDetails, HeartBeat, 
        Hello, MessageType, RequestError, ResultError, ResultOk };

