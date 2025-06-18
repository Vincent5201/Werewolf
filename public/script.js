const socket = io();
let myName = '';
let mySeat = null;

function joinRoom() {
  const name = document.getElementById('nameInput').value.trim();
  const room = document.getElementById('roomInput').value.trim();
  if (!name || !room) return;

  myName = name;
  socket.emit('join room', { roomId: room, name });

  document.getElementById('roomTitle').innerText = `房號：${room}`;
}

socket.on('name exists', () => {
  document.getElementById('errorMsg').innerText = '名稱已存在，請換一個';
});

socket.on('update seats', ({ seats }) => {
  const seatContainer = document.getElementById('seatsContainer');
  seatContainer.innerHTML = '';

  seats.forEach((occupant, i) => {
    const div = document.createElement('div');
    div.classList.add('seat');
    if (occupant) {
      div.textContent = occupant;
      div.classList.add('occupied');
      if (occupant === myName) {
        div.classList.remove('occupied');
        div.classList.add('me');
        mySeat = i;
        div.addEventListener('click', () => {
          socket.emit('stand up');
          mySeat = null;
        });
      }
    } else {
      div.textContent = '';
      div.addEventListener('click', () => {
        if (mySeat === null) {
          socket.emit('sit down', i);
        }
      });
    }
    seatContainer.appendChild(div);
  });

  document.getElementById('login').style.display = 'none';
  document.getElementById('chatroom').style.display = 'block';
});

// 聊天功能
const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');

form.addEventListener('submit', e => {
  e.preventDefault();
  if (input.value) {
    socket.emit('chat message', input.value);
    input.value = '';
  }
});

socket.on('chat message', msg => {
  const item = document.createElement('li');
  item.textContent = msg;
  messages.appendChild(item);
});
