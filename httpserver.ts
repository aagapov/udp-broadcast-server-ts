import express, { Express, Request, Response } from "express";
import { Server } from "./server";
import { UUID } from "crypto";

class HttpServer
{
    private readonly app: Express = express();
    private port = process.env.PORT || 3000;
    private readonly udpServer = new Server();
    
    constructor()
    {
        this.app.get('/', (req, res) => 
        {
            res.send('Hello World!');
        })
        
        this.app.get('/clients', (req, res) => 
        {    
            let response: string = '<html><body><h2>Clients available on-line</h2>';
            response += '<head> <style> table, th, td { border: 1px solid black; } </style> </head>';
            response += '<table style="width:100%"> <tr> <th>Client Id</th> <th>Available functions</th> </tr>';

            [...this.udpServer.clients.values()].forEach((el) =>
            {
                response += "<tr>";
                response += `<td>${el.info.id}</td>`; 
                response += `<td>${el.info.capacities}</td>`;
                response += "</tr>";
            });
            response += "</table></body></html>";
            console.log(response);
            res.send(response);
            res.end();
        })
        
        this.app.get('/clients/:clientId/', async (req, res) => 
        {  
            console.log("Trying  to get client info");            
            const result = await this.udpServer.sendGetClientDetails(req.params.clientId as UUID);

            let response: string = '<html><body><h2>Client details</h2>';
            if (result === undefined || typeof result === "number")
            {
                response += `<br>Failed to get info about client with id: ${req.params.clientId}`;
            }
            else
            {
                response += `<br>Client info: ${req.params.clientId}, ${result.capacities}`;
                response += `<br><img src="${result.icon}", alt="icon"/>`
            }
            response += '</body></html>';
            console.log(response);
            res.send(response);
            res.end();
        })
        
        this.app.get('/clients/:clientId/:function/', async (req, res) => 
        {    
            console.log("Trying  to get client info");            
            const result = await this.udpServer.callFunction(req.params.clientId as UUID, req.params.function);

            let response: string = `<html><body><h2>Result of calling function ${req.params.function}: </h2>`;
            if (result === undefined)
            {
                response += `<br>Failed to call function on client with id: ${req.params.clientId}`;
            }
            else
            {
                response += `<h3> ${result} <h3/>`;
            }
            response += '</body></html>';
            console.log(response);
            res.send(response);
            res.end();
        })

        this.app.get('/clients/:clientId/randomNumber/:min/:max', async (req, res) => 
        {    
            console.log("Trying  to get client info");            
            const result = await this.udpServer.callFunction(req.params.clientId as UUID, "randomNumber", [req.params.min, req.params.max]);

            let response: string = `<html><body><h2>Result of calling function randomNumber(${req.params.min}, ${req.params.max}): </h2>`;
            if (result === undefined)
            {
                response += `<br>Failed to call function on client with id: ${req.params.clientId}`;
            }
            else
            {
                response += `<h3> ${result} <h3/>`;
            }
            response += '</body></html>';
            console.log(response);
            res.send(response);
            res.end();
        })
    }    

    public async run()
    {
        this.app.listen(this.port, () => 
        {
            console.log(`Example app listening on port ${this.port}`);
        })
        this.udpServer.run();          
    }
}

const server = new HttpServer();
server.run();