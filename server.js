const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// 讓 Express 提供 public 資源（像是 index.html、script.js）
app.use(express.static('public'));

// Socket.IO 連線處理
io.on('connection', socket => {
  console.log('someone connected');

  socket.on('join room', roomId => {
    socket.join(roomId);
    console.log(`use enter room ${roomId}`);
    socket.to(roomId).emit('chat message', `someone enter room ${roomId}`);
  });

  socket.on('chat message', ({ roomId, message }) => {
    io.to(roomId).emit('chat message', message);
  });

  socket.on('disconnect', () => {
    console.log('someone leave');
  });
});

// ✅ 修正這裡，讓 Render 使用環境變數的 PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
