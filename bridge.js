/**
 * @file bridge.js
 * @description WebSocket (Browser) <-> TCP (C Server) Bridge
 */

const WebSocket = require('ws');
const net = require('net');
require('dotenv').config();

const WS_PORT = process.env.WS_PORT || 9000;
const TCP_PORT = parseInt(process.env.TCP_PORT) || 9001;
const TCP_HOST = process.env.TCP_HOST || '127.0.0.1';

// 1. WebSocket Server (for Browser)
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`🚀 WebSocket Bridge listening on ws://localhost:${WS_PORT}`);

// 2. TCP Client (to C Server)
let tcpClient = null;

function connectToCServer() {
    console.log(`🔗 Connecting to C Server at ${TCP_HOST}:${TCP_PORT}...`);
    tcpClient = new net.Socket();

    tcpClient.connect(TCP_PORT, TCP_HOST, () => {
        console.log('✅ Successfully connected to C Server');
    });

    let buffer = Buffer.alloc(0);

    tcpClient.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);

        while (buffer.length >= 4) {
            // Read 4-byte length (Big Endian as per htonl)
            const msgLen = buffer.readUInt32BE(0);

            if (buffer.length >= 4 + msgLen) {
                const jsonStr = buffer.slice(4, 4 + msgLen).toString();
                buffer = buffer.slice(4 + msgLen);

                // Forward to all connected WS clients
                const clientCount = wss.clients.size;
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(jsonStr);
                    }
                });
                // if (clientCount > 0) {
                //     console.log(`📤 Forwarded JSON to ${clientCount} clients: ${jsonStr.substring(0, 50)}...`);
                // }
            } else {
                break;
            }
        }
    });

    tcpClient.on('close', () => {
        console.log('❌ C Server disconnected. Retrying in 2 seconds...');
        setTimeout(connectToCServer, 2000);
    });

    tcpClient.on('error', (err) => {
        console.error('⚠️ TCP Error:', err.message);
    });
}

connectToCServer();

wss.on('connection', (ws) => {
    console.log('👤 Browser client connected');
    ws.on('close', () => console.log('👤 Browser client disconnected'));
});
