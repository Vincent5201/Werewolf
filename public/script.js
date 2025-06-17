const socket = io();
let currentRoom = null;

function joinRoom() {
  const roomId = document.getElementById('room-input').value.trim();
  if (roomId) {
    enterRoom(roomId);
  }
}

function createRoom() {
  const roomId = Math.random().toString(36).substr(2, 6);
  enterRoom(roomId);
}

function enterRoom(roomId) {
  currentRoom = roomId;
  socket.emit('join room', roomId);

  document.getElementById('room-section').style.display = 'none';
  document.getElementById('chat').style.display = 'block';
  document.getElementById('room-title').innerText = `你在房間：${roomId}`;
}

// send message
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

form.addEventListener('submit', e => {
  e.preventDefault();
  if (input.value && currentRoom) {
    socket.emit('chat message', { roomId: currentRoom, message: input.value });
    input.value = '';
  }
});

// receive message
socket.on('chat message', msg => {
  const item = document.createElement('li');
  item.textContent = msg;
  messages.appendChild(item);
});
