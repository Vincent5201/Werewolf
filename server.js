// === server.js（狼人殺完整邏輯）===

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

const rolesList = [
    'seer', 'witch', 'hunter', 'idiot',
    'werewolf', 'werewolf', 'werewolf', 'werewolf',
    'villager', 'villager', 'villager', 'villager'
];

const rooms = {};

io.on('connection', socket => {
    let currentRoom = null;
    let playerName = null;
    let currentSeat = null;

    socket.on('join room', ({ roomId, name }) => {
        currentRoom = roomId;
        playerName = name;

        if (!rooms[roomId]) {
            rooms[roomId] = {
                seats: Array(12).fill(null),
                users: {},
                sockets: {},
                gameStarted: false,
                roles: {},
                nightActions: {},
                votes: {},
                alive: {},
                witchUsed: { save: false, poison: false },
                dayCount: 0
            };
        }
        const nameExists = Object.values(rooms[roomId].users).includes(name);
        if (nameExists) {
            socket.emit('name exists');
            return;
        }

        socket.join(roomId);
        rooms[roomId].users[socket.id] = name;
        rooms[roomId].sockets[name] = socket;
        io.to(roomId).emit('update seats', {
            seats: rooms[roomId].seats
        });
    });

    socket.on('chat message', msg => {
        if (currentRoom && playerName) {
            const room = rooms[currentRoom];
            if (room && room.alive[playerName]) {
                io.to(currentRoom).emit('chat message', `${playerName}: ${msg}`);
            }
        }
    });

    socket.on('sit down', seatIndex => {
        const room = rooms[currentRoom];
        if (!room || room.gameStarted) return;
        if (seatIndex < 0 || seatIndex >= 12) return;

        if (room.seats[seatIndex] === null) {
            if (currentSeat !== null) {
                room.seats[currentSeat] = null;
            }
            room.seats[seatIndex] = playerName;
            currentSeat = seatIndex;
            io.to(currentRoom).emit('update seats', { seats: room.seats });
        }
    });

    socket.on('stand up', () => {
        const room = rooms[currentRoom];
        if (!room || room.gameStarted) return;
        if (currentSeat !== null) {
            room.seats[currentSeat] = null;
            currentSeat = null;
            io.to(currentRoom).emit('update seats', { seats: room.seats });
        }
    });

    socket.on('start game', () => {
        const room = rooms[currentRoom];
        if (!room || room.gameStarted) return;

        const players = room.seats.map((name, index) => ({ name, index })).filter(p => p.name);
        if (players.length !== 12) {
            socket.emit('chat message', '需要 12 人才能開始遊戲');
            return;
        }

        const shuffledRoles = [...rolesList].sort(() => Math.random() - 0.5);
        players.forEach((p, i) => {
            room.roles[p.name] = shuffledRoles[i];
            room.alive[p.name] = true;
        });

        room.witchUsed = { save: false, poison: false };
        room.dayCount = 0;
        room.gameStarted = true;
        
        for (const [socketId, name] of Object.entries(room.users)) {
            const role = room.roles[name];
            io.to(socketId).emit('your role', role);
        }

        io.to(currentRoom).emit('chat message', '遊戲開始！請準備進入夜晚...');
        setTimeout(() => startNightPhase(currentRoom), 3000);
    });

    function startNightPhase(roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        room.nightActions = { wolfVotes: {}, seerCheck: null, victim: null, poison: null, ends: {}};
        io.to(roomId).emit('night phase');

        const werewolves = Object.keys(room.roles).filter(name => room.roles[name] === 'werewolf');
        for (const name of werewolves) {
            const socket = room.sockets[name];
            if (socket) {
                socket.emit('werewolf teammates', werewolves.filter(n => n !== name));
            }
        }

        for (const [socketId, name] of Object.entries(room.users)) {
            if (!room.alive[name]) continue;
            const role = room.roles[name];
            if (role === 'seer') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'seer', players: aliveNames });
            } else if (role === 'werewolf') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'wolf', players: aliveNames });
            } else if(role === 'witch') {
                continue;
            } else {
                room.nightActions.ends[name] = true;
            }
        }
    }

    socket.on('night result', ({ type, target }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted) return;
        if (type === 'seer') {
            const role = room.roles[target];
            if (role === 'werewolf') {
                socket.emit('seer result', { target, role:'bad'});
            } else {
                socket.emit('seer result', { target, role:'good'});
            }
            room.nightActions.ends[playerName] = true;
        } else if (type === 'wolf') {
            if (!room.nightActions.wolfVotes[target]) {
                room.nightActions.wolfVotes[target] = 0;
            }
            room.nightActions.wolfVotes[target]++;
            const aliveWolves = Object.keys(room.roles).filter(name =>
                room.roles[name] === 'werewolf' && room.alive[name]
            );
            const totalVotes = Object.values(room.nightActions.wolfVotes).reduce((a, b) => a + b, 0);
            if (totalVotes === aliveWolves.length) {
                let maxVotes = 0;
                let candidates = [];
                for (const [target, count] of Object.entries(room.nightActions.wolfVotes)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        candidates = [target];
                    } else if (count === maxVotes) {
                        candidates.push(target);
                    }
                }

                const victim = candidates.length === 1 ? candidates[0] : null;
                room.nightActions.victim = victim;
                const witchName = Object.keys(room.roles).find(name => room.roles[name] === 'witch');
                const witchSocket = room.sockets[witchName];

                if (witchSocket && room.alive[witchName]) {
                    witchSocket.emit('night action', {
                        type: 'witch',
                        victim: victim,
                        players: Object.keys(room.alive).filter(n => room.alive[n]),
                        used: room.witchUsed
                    });
                }
            }
            room.nightActions.ends[playerName] = true;
        } else if (type === 'witch-save' && !room.witchUsed.save) {
            room.nightActions.victim = null;
            room.witchUsed.save = true;
            room.nightActions.ends[playerName] = true;
        } else if (type === 'witch-poison' && !room.witchUsed.poison) {
            room.nightActions.poison = target;
            room.witchUsed.poison = true;
            room.nightActions.ends[playerName] = true;
        } else if (type === 'witch-skip' || type === 'witch-save' || type === 'witch-poison') {
            room.nightActions.ends[playerName] = true;
        } 
        checkNightEnd(currentRoom);
    });

    function checkNightEnd(roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const alivePlayers = Object.keys(room.roles).filter(name => room.alive[name]);
        const donePlayers = Object.keys(room.nightActions.ends);
        if (donePlayers.length === alivePlayers.length) {
            setTimeout(() => startDayPhase(roomId), 3000);
        }
    }

    function startDayPhase(roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        room.dayCount++;

        const victim = room.nightActions.victim;
        const poisoned = room.nightActions.poison;

        let deathList = [];
        if (victim && room.alive[victim]) {
            deathList.push(victim);
            room.alive[victim] = false;
        }
        if (poisoned && room.alive[poisoned]) {
            deathList.push(poisoned);
            room.alive[poisoned] = false;
        }

        io.to(roomId).emit('chat message', `第 ${room.dayCount} 天 天亮了，死亡名單：${deathList.join(', ') || '無人死亡'}`);
        checkGameEnd(roomId);
        room.votes = {};
        checkHunter(roomId, victim, () => {
            const candidates = Object.keys(room.alive).filter(n => room.alive[n]);
            io.to(roomId).emit('start vote', { candidates });
        });
    }

    function checkHunter(roomId, victim, onDone) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        if (room.roles[victim] === 'hunter') {
            const hunterSocketId = room.sockets[victim]?.id;
            if (hunterSocketId) {
                io.to(hunterSocketId).emit('hunter shoot', {
                    players: Object.keys(room.alive).filter(n => room.alive[n])
                });
                room.hunterCallback = onDone;
                return;
            }
        }
        if (typeof onDone === 'function') onDone();
    }

    socket.on('hunter shot', target => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || room.roles[playerName] !== 'hunter') return;

        if (target && room.alive[target]) {
            room.alive[target] = false;
            io.to(currentRoom).emit('chat message', `${playerName} 在死前開槍射殺了 ${target}！`);
        }
        checkGameEnd(currentRoom);
        if (typeof room.hunterCallback === 'function') {
            room.hunterCallback();
            room.hunterCallback = null;
        }
    });

    socket.on('vote', voted => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || !room.alive[playerName]) return;
        room.votes[playerName] = voted;

        if (Object.keys(room.votes).length === Object.keys(room.alive).filter(n => room.alive[n]).length) {
            const result = mostFrequent(Object.values(room.votes));
            if (room.alive[result]) room.alive[result] = false;
            io.to(currentRoom).emit('chat message', `被投票處決的是：${result}`);
            checkGameEnd(currentRoom);
            checkHunter(currentRoom, result, () => {
                startNightPhase(currentRoom);
            });
        }
    });

    function checkGameEnd(roomId) {
        const room = rooms[roomId];
        const aliveRoles = Object.entries(room.alive).filter(([name, alive]) => alive).map(([name]) => room.roles[name]);
        const wolves = aliveRoles.filter(r => r === 'werewolf').length;
        const villager = aliveRoles.filter(r => r === 'villager').length;
        const god = aliveRoles.length - wolves - villager;

        if (wolves === 0) {
            io.to(roomId).emit('chat message', '遊戲結束，好人獲勝！');
            room.gameStarted = false;
        } else if (wolves >= villager + god || villager === 0 || god === 0) {
            io.to(roomId).emit('chat message', '遊戲結束，狼人獲勝！');
            room.gameStarted = false;
        }
    }

    socket.on('disconnect', () => {
        const room = rooms[currentRoom];
        if (room) {
            delete room.users[socket.id];
            if (currentSeat !== null) room.seats[currentSeat] = null;
            io.to(currentRoom).emit('update seats', { seats: room.seats });
        }
    });
});

function mostFrequent(arr) {
    const count = {};
    arr.forEach(v => (count[v] = (count[v] || 0) + 1));
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
