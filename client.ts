import * as dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import {CallFunction, ClientResponse, GetClients, GetClientDetails, 
    HeartBeat, Hello, MessageType, RequestError, ResultError, ResultOk } from './protocol';
import { ClientPort, ServerPort, sendHello } from "./common"

const message = Buffer.from('Some bytes');
const client = dgram.createSocket('udp4');

client.on('error', (err) => {
    console.error(`client error:\n${err.stack}`);
    client.close();
});

client.on('message', (msg, rinfo) => {
    console.log(`client got: ${msg} from ${rinfo.address}:${rinfo.port}`);
});

client.on('listening', () => {
    client.setBroadcast(true);
    const address = client.address();
    console.log(`client listening ${address.address}:${address.port}`);
    setInterval(()=>{
        const hello : Hello =
        {
            type: MessageType.HELLO,        
            data: null
        };
        const message = Buffer.from(JSON.stringify(hello));
        client.send(message, ServerPort);
    }, 2000);
});

client.bind(ClientPort);