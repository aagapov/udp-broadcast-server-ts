import * as dgram from "node:dgram";
import { Buffer } from 'node:buffer';
import {CallFunction, ClientResponse, GetClients, GetClientDetails, 
        HeartBeat, Hello, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import {ServerPort, sendHello} from "./common"

const server = dgram.createSocket('udp4');

server.on('error', (err) => {
    console.error(`server error:\n${err.stack}`);
    server.close();
});

server.on('message', (msg, rinfo) => {
    console.log(`server got: ${msg} from ${rinfo.address}:${rinfo.port}`);
});

server.on('listening', () => {
    const address = server.address();
    console.log(`server listening ${address.address}:${address.port}`);
});

server.bind(ServerPort);