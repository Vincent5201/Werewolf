const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

io.on('connection', socket => {
  console.log('someone connected');

  socket.on('chat message', msg => {
    io.emit('chat message', msg);
  });

  socket.on('disconnect', () => {
    console.log('someone leave');
  });
});

server.listen(3000, () => {
  console.log('host run on http://localhost:3000');
});
