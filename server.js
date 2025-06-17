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

  socket.on('chat message', msg => {
    io.emit('chat message', msg); // 廣播給所有連線的人
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
