import express, { Express, Request, Response } from "express";
import { Server } from "./server";
import { UUID, createHash } from "crypto";
import { PathLike } from "fs";
import * as fs from 'node:fs';
import path from "path";
enum KeyErrors
{
    KEY_NOT_FOUND = 'KEY_NOT_FOUND',
    KEY_TOO_SHORT = 'KEY_TOO_SHORT',
    KEY_TOO_LONG  = 'KEY_TOO_LONG',
    UNAUTHORIZED  = 'UNAUTHORIZED',
};

type HttpRequest<TThis> = (this: TThis, req: Request, res: Response) => Promise<void>;

type Decorator<TThis> = (
  originalMethod: HttpRequest<TThis>,
  context: ClassMethodDecoratorContext<TThis, HttpRequest<TThis>>
) => HttpRequest<TThis>;

function KeyProtected<TThis>(file: PathLike): Decorator<TThis> 
{
    function decoratorFunction <TThis>(
        originalMethod: HttpRequest<TThis>,
        context: ClassMethodDecoratorContext<TThis, HttpRequest<TThis>>
    )
    {
        async function wrapperFunction (this: TThis, req: Request, res: Response): Promise<void>
        {
            try
            {
                if (fs.lstatSync(file).isDirectory())
                {
                    file = path.join(file.toString(), 'key.txt');
                }
                const key = fs.readFileSync(file, 'utf8');
        
                if (key.length == 0)
                {
                    throw Error(KeyErrors.KEY_NOT_FOUND);
                }
                if (key.length < 8)
                {
                    throw Error(KeyErrors.KEY_TOO_SHORT);
                } 
                if (key.length > 255)
                {
                    throw Error(KeyErrors.KEY_TOO_LONG);
                }
        
                const hash = createHash('sha256');
                hash.update(key);

                const authKey = req.query["keyAuth"];
                if (authKey === undefined || typeof authKey !== 'string')
                {
                    throw Error(KeyErrors.UNAUTHORIZED);
                }
    
                const authKeyHash = createHash('sha256');
                authKeyHash.update(authKey);
        
                if (hash.digest('base64') !== authKeyHash.digest('base64'))
                {
                    throw Error(KeyErrors.UNAUTHORIZED);
                }
                
                return originalMethod.call(this, req, res);
            }
            catch(error)
            {
                const msg = (error as Error).message;
                console.error(msg);

                if (msg === KeyErrors.UNAUTHORIZED)
                {
                    res.send(msg);
                }
                else
                {
                    throw error;
                }                
            }
        } 
        
        return wrapperFunction;  
    }

    return decoratorFunction;
}
class HttpServer
{
    private readonly app: Express = express();
    private port = process.env.PORT || 3000;
    private readonly udpServer = new Server();

    @KeyProtected("key.txt")
    private async rootHandler(req: Request, res: Response) 
    {
        res.send('Hello! This is my HTTP server');
    }

    @KeyProtected("key.txt")
    private async clientsHandler(req: Request, res: Response) 
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
    }

    @KeyProtected("key.txt")
    private async getClientDetailsHandler(req: Request, res: Response)
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
    }

    @KeyProtected("key.txt")
    private async callFunctionHandler(req: Request, res: Response)
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
    }

    constructor()
    {
        this.app.get('/', async (req, res) => this.rootHandler(req, res));
        
        this.app.get('/clients', async (req, res) => this.clientsHandler(req, res));
        
        this.app.get('/clients/:clientId', async (req, res) => this.getClientDetailsHandler(req, res));       
        
        this.app.get('/clients/:clientId/:function/', async (req, res) => this.callFunctionHandler(req, res));        

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