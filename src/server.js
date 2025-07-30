import Fastify from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import { connect, StringCodec } from 'nats';
import { guid } from './utils.js';

const fastify = Fastify({ logger: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

const NATS_URL = 'ws://localhost:4222';

let clients = {};
const games = {};

async function start() {
  const connection = await connect({ servers: NATS_URL });
  const sc = StringCodec();

  // generate a client id
  // let gameId = guid();

  const clientConnectSub = connection.subscribe('client.connect');
  (async () => {
    for await (const m of clientConnectSub) {
      const clientId = guid();
      const gameId = guid();

      const msg = sc.decode(m.data);

      const result = JSON.parse(msg);
      const { handshakeId } = result;

      clients[clientId] = {
        connectionId: `client.connect.${handshakeId}`,
        connection: connection,
      };
      console.log('server', `client.connect.${handshakeId}`);
      connection.publish(
        `client.connect.${handshakeId}`,
        sc.encode(
          JSON.stringify({
            gameId: gameId,
            clientId: clientId,
          })
        )
      );
    }
  })();

  // listen for create game - user want to create a new game
  const sub = connection.subscribe('client.create');
  (async () => {
    for await (const m of sub) {
      const msg = sc.decode(m.data);
      const response = JSON.parse(msg);

      const clientId = response.clientId;
      const gameId = guid();

      games[gameId] = {
        id: gameId,
        cells: Array(9).fill(null),
        clients: [],
      };

      const payload = {
        clientId: clientId,
        game: games[gameId],
      };
      const con = clients[clientId]?.connection;

      if (con) {
        con.publish('server.create', sc.encode(JSON.stringify(payload)));
      }
    }
  })();

  // listen for join game - user want to join a game
  const joinSub = connection.subscribe('client.join');
  (async () => {
    for await (const m of joinSub) {
      const msg = sc.decode(m.data);
      const response = JSON.parse(msg);

      const clientId = response.clientId;
      const gameId = response.gameId;
      const game = games[gameId];

      // Check if client is already in the game
      if (game.clients.some((client) => client.clientId === clientId)) {
        console.log(`Player ${clientId} is already in tha game ${gameId}`);
        continue;
      }

      //limit to 2 players
      if (game.clients.length >= 2) {
        console.log('Game is full, limit is 2 players');
        continue;
      }

      const players = { 0: 'X', 1: 'O' }[game.clients.length];

      game.clients.push({
        clientId: clientId,
        players: players,
      });

      game.clients.forEach((client) => {
        clients[client.clientId]?.connection.publish(
          'server.join',
          sc.encode(JSON.stringify({ game }))
        );
      });
    }
  })();

  fastify.get('/', async (request, reply) => {
    return reply.sendFile('index.html');
  });

  await fastify.listen({ port: 3001 });
  console.log('Server running at http://localhost:3001');
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
