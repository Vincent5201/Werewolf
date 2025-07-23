const { table } = require('console');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));
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
                dayCount: 0,
                rolesConfig: null,
                host: socket.id,
                firstTalk: null,
                talking: null,
                callback: null,
                lastWord: null,
                debate: null,
                debateIdx: null
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
        if (socket.id === rooms[roomId].host) {
            socket.emit('you are host');
        }
        io.to(roomId).emit('update seats', {
            seats: rooms[roomId].seats
        });
    });

    socket.on('set roles config', (config) => {
        const room = rooms[currentRoom];
        if (!room || socket.id !== room.host || room.gameStarted) return;
        room.rolesConfig = config;
        socket.emit('chat message', '角色配置已更新');
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

        let rolesList = [];
        const config = room.rolesConfig || {
            guard: 1, werewolf: 1, villager: 2
        };

        for (const [role, count] of Object.entries(config)) {
            for (let i = 0; i < count; i++) {
                rolesList.push(role);
            }
        }
        
        const players = room.seats.map((name, index) => ({ name, index })).filter(p => p.name);
        if (players.length !== rolesList.length) {
            socket.emit('chat message', `目前入座人數為 ${players.length}，但角色總數為 ${rolesList.length}，無法開始遊戲`);
            return;
        }

        const shuffledRoles = [...rolesList].sort(() => Math.random() - 0.5);
        players.forEach((p, i) => {
            room.roles[p.name] = shuffledRoles[i];
            room.alive[p.name] = true;
            console.log(`${p.name} 是 ${shuffledRoles[i]}`)
        });

        room.witchUsed = { save: false, poison: false };
        room.dayCount = 0;
        room.gameStarted = true;
        room.nightActions.guard = null;
        room.nightActions.save = null;
        room.nightActions.poison = null;
        
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

        const werewolves = Object.keys(room.roles).filter(name => (room.roles[name] === 'werewolf' || room.roles[name] === 'wolfhunter'));
        for (const name of werewolves) {
            const socket = room.sockets[name];
            if (socket) {
                socket.emit('werewolf teammates', werewolves.filter(n => n !== name));
            }
        }
        room.nightActions.save = null;
        room.nightActions.poison = null;
        for (const [socketId, name] of Object.entries(room.users)) {
            if (!room.alive[name]) continue;
            const role = room.roles[name];
            if (role === 'seer') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'seer', players: aliveNames });
            } else if (role === 'werewolf') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'werewolf', players: aliveNames });
            } else if (role === 'wolfhunter') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'wolfhunter', players: aliveNames });
            } else if(role === 'guard') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: 'guard', players: aliveNames, lastTarget: room.nightActions.guard});
            } else if(role === 'witch') {
                continue;
            } else {
                room.nightActions.ends[name] = true;
            }
        }
    }

    socket.on('night result', ({ type, target }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || room.nightActions.ends[playerName]) return;
        if (type === 'seer') {
            const role = room.roles[target];
            if (role === 'werewolf' || role === 'wolfhunter') {
                socket.emit('seer result', { target, role:'bad'});
            } else {
                socket.emit('seer result', { target, role:'good'});
            }
        } else if (type === 'werewolf' || type === 'wolfhunter') {
            if (!room.nightActions.wolfVotes[target]) {
                room.nightActions.wolfVotes[target] = 0;
            }
            room.nightActions.wolfVotes[target]++;
            const aliveWolves = Object.keys(room.roles).filter(name =>
                (room.roles[name] === 'werewolf' || room.roles[name] === 'wolfhunter') && room.alive[name]
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
        } else if (type === 'witch-save' && !room.witchUsed.save) {
            room.nightActions.save = target;
            room.witchUsed.save = true;
        } else if (type === 'witch-poison' && !room.witchUsed.poison) {
            room.nightActions.poison = target;
            room.witchUsed.poison = true;
        } else if (type === 'guard') {
            room.nightActions.guard = target;
        }
        room.nightActions.ends[playerName] = true;
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

        let victim = room.nightActions.victim;
        const poisoned = room.nightActions.poison;
        const guard = room.nightActions.guard;
        const save = room.nightActions.save;

        if (save && guard) {
            if (guard !== save) {
                victim = null;
            }
        } else if (save) {
            victim = null;
        } else if (guard && guard === victim) {
            victim = null;
        }

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

        if (deathList.length === 1) {
            room.firstTalk = room.seats.indexOf(deathList[0]);
            while (!room.alive[room.seats[room.firstTalk]]) {
                room.firstTalk++;
                room.firstTalk %= 12;
            }
        } else {
            const alivePlayers = Object.keys(room.alive).filter(name => room.alive[name]);
            const randomIndex = Math.floor(Math.random() * alivePlayers.length);
            room.firstTalk = room.seats.indexOf(alivePlayers[randomIndex]);
        }

        room.talking = room.firstTalk;
        checkHunter(roomId, victim, () => {
            const tmp = room.seats[room.talking];
            io.to(roomId).emit('start talking', { talking: tmp });
        });
    }

    function checkHunter(roomId, victim, onDone) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        if (room.roles[victim] === 'hunter' || room.roles[victim] === 'wolfhunter') {
            const hunterSocket = room.sockets[victim];
            if (hunterSocket) {
                room.callback = onDone;
                hunterSocket.emit('hunter shoot', {
                    players: Object.keys(room.alive).filter(n => room.alive[n])
                });
            }
        } else {
            setTimeout(() => onDone(), 3000);
        }
    }

    socket.on('hunter shot', target => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted) return;

        if (target && target in room.alive && room.alive[target]) {
            room.alive[target] = false;
            io.to(currentRoom).emit('chat message', `${playerName} 在死前開槍射殺了 ${target}！`);
        }
        checkGameEnd(currentRoom);
        if (typeof room.callback === 'function') {
            room.callback();
            room.callback = null;
        }
    });

    socket.on('end talking', playerName => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName != room.seats[room.talking]) return;
        room.talking++;
        room.talking %= 12;
        while (!room.alive[room.seats[room.talking]]) {
            room.talking++;
            room.talking %= 12;
        }
        if (room.talking == room.firstTalk) {
            const candidates = Object.keys(room.alive).filter(n => room.alive[n]);
            room.votes = {};
            room.debate = null;
            io.to(currentRoom).emit('start voting', { candidates });
        } else {
            const name = room.seats[room.talking];
            io.to(currentRoom).emit('start talking', { talking: name });
        }
    });

    socket.on('vote', ({ playerName, voted }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || !room.alive[playerName]) return;
        if (room.debate === null) {
            room.votes[voted] = (room.votes[voted] || 0) + 1;
            const totalVotes = Object.values(room.votes).reduce((sum, count) => sum + count, 0);
            if (totalVotes === Object.keys(room.alive).filter(n => room.alive[n]).length) {
                const result = getTopVoted(room.votes);
                if (result.length === 1) {
                    if (room.alive[result[0]]) room.alive[result[0]] = false;
                    io.to(currentRoom).emit('chat message', `被投票處決的是：${result[0]}`);
                    if (room.roles[result[0]] === 'idiot') io.to(currentRoom).emit('chat message', `他是白癡`);
                    checkGameEnd(currentRoom);
                    room.lastWord = result[0];
                    io.to(currentRoom).emit('last words', { talking: result[0] });
                } else {
                    room.debate = result;
                    room.debateIdx = 0;
                    io.to(currentRoom).emit('start debate', { talking: room.debate[room.debateIdx] });
                }
            }
        } else {
            if (room.debate.includes(playerName)) return;
            room.votes[voted] = (room.votes[voted] || 0) + 1;
            const totalVotes = Object.values(room.votes).reduce((sum, count) => sum + count, 0);
            const otherscount = Object.keys(room.alive).filter(n => {
                return room.alive[n] && !room.debate.includes(n);
            }).length;
            if (totalVotes === otherscount) {
                room.debate = null;
                const result = getTopVoted(room.votes);
                if (result.length === 1) {
                    if (room.alive[result[0]]) room.alive[result[0]] = false;
                    io.to(currentRoom).emit('chat message', `被投票處決的是：${result[0]}`);
                    if (room.roles[result[0]] === 'idiot') io.to(currentRoom).emit('chat message', `他是白癡`);
                    checkGameEnd(currentRoom);
                    room.lastWord = result[0];
                    io.to(currentRoom).emit('last words', { talking: result[0] });
                } else {
                    startNightPhase(currentRoom);
                }
            } 
        }

        
    });

    socket.on('end last words', playerName => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName != room.lastWord) return;
        checkHunter(currentRoom, playerName, () => {
            startNightPhase(currentRoom);
        });
    });

    socket.on('end debate', playerName => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName != room.debate[room.debateIdx]) return;
        room.debateIdx++;
        room.debateIdx %= room.debate.length;
        if (room.debateIdx === 0) {
            room.votes = {};
            io.to(currentRoom).emit('start voting', { candidates: room.debate });
        } else {
            io.to(currentRoom).emit('start debate', { talking: room.debate[room.debateIdx] });
        }
    });


    function checkGameEnd(roomId) {
        const room = rooms[roomId];
        const aliveRoles = Object.entries(room.alive).filter(([name, alive]) => alive).map(([name]) => room.roles[name]);
        const wolves = aliveRoles.filter(r => (r === 'werewolf' || r === 'wolfhunter')).length;
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

function getTopVoted(votes) {
    let maxVote = -Infinity;
    const topCandidates = [];
    for (const [name, count] of Object.entries(votes)) {
        if (count > maxVote) {
            maxVote = count;
            topCandidates.length = 0;
            topCandidates.push(name);
        } else if (count === maxVote) {
            topCandidates.push(name);
        }
    }
    return topCandidates;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
