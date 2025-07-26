const { table } = require('console');
const express = require('express');
const http = require('http');
const { type } = require('os');
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
                playersCount: 0,
                alive: {},
                witchUsed: { save: false, poison: false },
                dayCount: 0,
                rolesConfig: null,
                host: socket.id,
                callback: null,
                withPolice: false,
                police: null,
                talkingDirec: 1,
                state: null
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
        room.withPolice = config.police;
        socket.emit('chat message', '遊戲配置已更新');
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

    function seatsContinuous(seats) {
        const seatedIndices = seats
            .map((name, i) => name !== null ? i : null)
            .filter(i => i !== null)
            .sort((a, b) => a - b);

        if (seatedIndices.length === 0) return 0;
        const start = seatedIndices[0];
        for (let i = 0; i < seatedIndices.length; i++) {
            if (seatedIndices[i] !== start + i) {
                return 0;
            }
        }
        return seatedIndices.length;
    }

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
            if (role === 'police') continue;
            for (let i = 0; i < count; i++) {
                rolesList.push(role);
            }
        }

        const players = room.seats.map((name, index) => ({ name, index })).filter(p => p.name);
        const totalRoles = Object.entries(config)
                            .filter(([key, val]) => typeof val === 'number' && key !== 'police')
                            .reduce((sum, [, val]) => sum + val, 0);
        if (players.length !== totalRoles) {
            socket.emit('chat message', `目前入座人數為 ${players.length}，但角色總數為 ${totalRoles}，無法開始遊戲`);
            return;
        }

        room.playersCount = seatsContinuous(room.seats);
        if (room.playersCount === 0) {
            socket.emit('chat message', '請大家依序坐好，不要留空位' );
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
        room.police = null;
        
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

        room.state = 'night';
        room.nightActions = { wolfVotes: {}, seerCheck: null, victim: null, poison: null, save: null, ends: {}};
        io.to(roomId).emit('night phase');

        const werewolves = Object.keys(room.roles).filter(name => (room.roles[name] === 'werewolf' || room.roles[name] === 'wolfhunter'));
        for (const name of werewolves) {
            const socket = room.sockets[name];
            if (socket) {
                socket.emit('werewolf teammates', werewolves.filter(n => n !== name));
            }
        }
        
        for (const [socketId, name] of Object.entries(room.users)) {
            if (!room.alive[name]) continue;
            const role = room.roles[name];
            if (role === 'seer' || role === 'werewolf' || role === 'wolfhunter') {
                const aliveNames = Object.keys(room.alive).filter(n => room.alive[n]);
                io.to(socketId).emit('night action', { type: role, players: aliveNames });
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
            room.nightActions.wolfVotes[target] = (room.nightActions.wolfVotes[target] || 0) + 1;
            const aliveWolves = Object.keys(room.roles).filter(name =>
                (room.roles[name] === 'werewolf' || room.roles[name] === 'wolfhunter') && room.alive[name]
            );
            const totalVotes = Object.values(room.nightActions.wolfVotes).reduce((a, b) => a + b, 0);
            
            if (totalVotes === aliveWolves.length) {
                const result = getTopVoted(room.nightActions.wolfVotes);
                room.nightActions.victim = result.length === 1 ? result[0] : null;
                const witchName = Object.keys(room.roles).find(name => room.roles[name] === 'witch');
                const witchSocket = room.sockets[witchName];

                if (witchSocket && room.alive[witchName]) {
                    witchSocket.emit('night action', {
                        type: 'witch',
                        victim: result,
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
            if (room.withPolice) {
                room.election = {}
                io.to(roomId).emit('police election');
            } else {
                startDayPhase(roomId);
            }
        }
    }

    socket.on('election reply', ({ playerName, choice }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName in room.election) return;

        room.election[playerName] = choice
        if (Object.keys(room.election).length === room.playersCount) {
            if (Object.keys(room.election).filter(n => room.election[n]).length > 0) {
                room.elecTalkingIdx = 0;
                while (room.election[room.seats[room.elecTalkingIdx]] !== true) {
                    room.elecTalkingIdx++;
                }
                io.to(currentRoom).emit('talking time', { talking: room.seats[room.elecTalkingIdx], phase: 'election' });
            } else {
                startDayPhase(currentRoom);
            }
        }
    });

    socket.on('end talking', ({ playerName, phase }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted) return;

        if (phase === 'election') {
            if (playerName != room.seats[room.elecTalkingIdx]) return;
            room.elecTalkingIdx++;
            while (room.elecTalkingIdx < room.playersCount && room.election[room.seats[room.elecTalkingIdx]] !== true)
                room.elecTalkingIdx++;
            
            if (room.elecTalkingIdx === room.playersCount) {
                room.votes = {};
                room.debate = null;
                const candidates = Object.keys(room.election).filter(name => room.election[name]);
                io.to(currentRoom).emit('election voting', { candidates });
            } else {
                io.to(currentRoom).emit('talking time', { talking: room.seats[room.elecTalkingIdx], phase: 'election' });
            }
        } else if (phase === 'elecDebate') {
            if (playerName != room.debate[room.debateIdx]) return;
            room.debateIdx++;
            if (room.debateIdx === room.debate.length) {
                room.votes = {};
                io.to(currentRoom).emit('election voting', { candidates: room.debate });
            } else {
                io.to(currentRoom).emit('talking time', { talking: room.debate[room.debateIdx], phase: 'elecDebate' });
            }
        } else if (phase === 'D1 last word') {
            if (playerName != room.D1LastWord[room.D1LastWordIdx]) return;
            room.D1LastWordIdx++;
            if (room.D1LastWordIdx === room.D1LastWord.length) {
                room.callback();
                room.callback = null;
            } else {
                io.to(currentRoom).emit('talking time', { talking: room.D1LastWord[room.D1LastWordIdx], phase: 'D1 last word' });
            }
        } else if (phase === 'shoted last word') {
            if (playerName != room.D1LastWord[room.D1LastWordIdx]) return;
            if (room.state === 'daytime') {
                startNightPhase(currentRoom);
            } else {
                startTalking(currentRoom, null);
            }
        } else if (phase === 'daytime') {
            if (playerName != room.seats[room.talking]) return;
            room.talking += room.talkingDirec;
            room.talking %= room.playersCount;
            while (!room.alive[room.seats[room.talking]]) {
                room.talking += room.talkingDirec;
                room.talking %= room.playersCount;
            }
            if (room.talking === room.firstTalk) {
                const candidates = Object.keys(room.alive).filter(n => room.alive[n]);
                room.votes = {};
                room.debate = null;
                io.to(currentRoom).emit('start voting', { candidates });
            } else {
                io.to(currentRoom).emit('talking time', { talking: room.seats[room.talking], phase: 'daytime' });
            }
        } else if (phase === 'last word') {
            if (playerName != room.lastWord) return;
            checkHunter(currentRoom, playerName, null);
        } else if (phase === 'debate') {
            if (playerName != room.debate[room.debateIdx]) return;

            room.debateIdx++;
            if (room.debateIdx === room.debate.length) {
                room.votes = {};
                io.to(currentRoom).emit('start voting', { candidates: room.debate });
            } else {
                io.to(currentRoom).emit('talking time', { talking: room.debate[room.debateIdx], phase: 'debate' });
            }
        }
    });

    socket.on('election vote', ({ playerName, voted }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || room.election[playerName]) return;
        let tgtVotes = Object.keys(room.election).filter(n => room.election[n] === false).length;
        
        room.votes[voted] = (room.votes[voted] || 0) + 1;
        const totalVotes = Object.values(room.votes).reduce((sum, count) => sum + count, 0);

        if (totalVotes === tgtVotes) {
            const result = getTopVoted(room.votes);
            if (result.length === 1) {
                room.debate = null;
                room.police = result[0];
                io.to(currentRoom).emit('chat message', `${result[0]}當選警長`);
                startDayPhase(currentRoom);
            } else {
                if (room.debate === null) {
                    room.debate = result;
                    room.debateIdx = 0;
                    io.to(currentRoom).emit('talking time', { talking: room.debate[room.debateIdx], phase: 'elecDebate' });
                } else {
                    room.debate = null;
                    startDayPhase(currentRoom);
                }
            }
        } 
    });

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
        
        if (room.police !== null && deathList.includes(room.police)) {
            sendPolice(roomId, () => checkD1LastWords(roomId, victim, deathList));
        } else {
            checkD1LastWords(roomId, victim, deathList);
        }
    }

    function checkD1LastWords(roomId, victim, deathList) {
        const room = rooms[roomId];
        if (room.dayCount === 1 && deathList.length > 0) {
            room.D1LastWord = deathList;
            room.D1LastWordIdx = 0;
            room.callback = () => checkHunter(roomId, victim, deathList);
            io.to(roomId).emit('talking time', { talking: room.D1LastWord[0], phase: 'D1 last word' });
        } else {
            checkHunter(roomId, victim, deathList);
        }
    }

    function sendPolice(roomId, onDone) {
        const room = rooms[roomId];
        room.policecallback = onDone;
        const candidates = Object.keys(room.alive).filter(n => room.alive[n]);
        io.to(roomId).emit('send police', { candidates: candidates});
    }

    socket.on('send', ({ playerName, send }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName !== room.police) return;
        room.police = send;
        room.policecallback();
        room.policecallback = null;
    });

    function checkHunter(roomId, victim, deathList) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        
        if (victim !== null && (room.roles[victim] === 'hunter' || room.roles[victim] === 'wolfhunter')) {
            const hunterSocket = room.sockets[victim];
            if (room.state === 'daytime') {
                room.callback = () => startNightPhase(roomId);
            } else {
                room.callback = () => startTalking(roomId, deathList);
            }
            hunterSocket.emit('hunter shoot', {
                players: Object.keys(room.alive).filter(n => room.alive[n])
            });
        } else {
            if (room.state === 'daytime') {
                startNightPhase(roomId);
            } else {
                startTalking(roomId, deathList);
            }
        }
    }
    socket.on('hunter shot', target => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted) return;

        if (target !== null && target in room.alive && room.alive[target]) {
            room.alive[target] = false;
            io.to(currentRoom).emit('chat message', `${playerName} 在死前開槍射殺了 ${target}！`);
            checkGameEnd(currentRoom);
            room.callback = null;
            
            if (room.dayCount === 1 || room.state === 'daytime') {
                if (target === room.police) {
                    sendPolice(currentRoom, () => shotedLastWord(currentRoom, target));
                } else {
                    shotedLastWord(currentRoom, target) 
                }
            } else {
                if (target === room.police) {
                    sendPolice(currentRoom, () => startTalking(currentRoom, null));
                } else {
                    startTalking(currentRoom, null);
                }
            }
        } else {
            room.callback();
            room.callback = null;
        }
    });

    function shotedLastWord(roomId, target) {
        const room = rooms[roomId];
        room.D1LastWord = [target];
        room.D1LastWordIdx = 0;
        io.to(currentRoom).emit('talking time', { talking: room.D1LastWord[0], phase: 'shoted last word' });
    }

    function startTalking(roomId, deathList) {
        const room = rooms[roomId];
        if (room.police === null) {
            if (deathList === null || deathList.length !== 1) {
                const alivePlayers = Object.keys(room.alive).filter(name => room.alive[name]);
                const randomIndex = Math.floor(Math.random() * alivePlayers.length);
                room.firstTalk = room.seats.indexOf(alivePlayers[randomIndex]);
            } else {
                room.firstTalk = room.seats.indexOf(deathList[0]);
                while (!room.alive[room.seats[room.firstTalk]]) {
                    room.firstTalk++;
                    room.firstTalk %= room.playersCount;
                }
            }
            room.talking = room.firstTalk;
            room.state = 'daytime';
            
            io.to(currentRoom).emit('talking time', { talking: room.seats[room.talking], phase: 'daytime' });
        } else {
            io.to(roomId).emit('select direction');
        }
    }

    socket.on('direction reply', ({ playerName, choice }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || playerName !== room.police) return;
        
        room.firstTalk = room.seats.indexOf(room.police);
        if (choice) {
            room.talkingDirec = Object.keys(room.alive).filter(name => room.alive[name]).length -1;
        } else {
            room.talkingDirec = 1;
        }
        room.firstTalk += room.talkingDirec;
        room.firstTalk %= room.playersCount;
        while (!room.alive[room.seats[room.firstTalk]]) {
            room.firstTalk += room.talkingDirec;
            room.firstTalk %= room.playersCount;
        }
        room.talking = room.firstTalk;
        room.state = 'daytime';
        io.to(currentRoom).emit('talking time', { talking: room.seats[room.talking], phase: 'daytime' });
    });

    socket.on('vote', ({ playerName, voted }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || !room.alive[playerName]) return;

        let tgtVotes = 0;
        if (room.debate !== null) {
            if (room.debate.includes(playerName)) return;
            tgtVotes = Object.keys(room.alive).filter(n => {
                return room.alive[n] && !room.debate.includes(n);
            }).length;
        } else {
            tgtVotes = Object.keys(room.alive).filter(n => room.alive[n]).length;
        }
        console.log(`${voted}一票`);
        room.votes[voted] = (room.votes[voted] || 0) + 1;
        if (playerName === room.police) room.votes[voted] += 0.5;
        const totalVotes = Object.values(room.votes).reduce((sum, count) => sum + count, 0);
        
        if (totalVotes === tgtVotes || totalVotes === tgtVotes + 0.5) {
            const result = getTopVoted(room.votes);
            if (result.length === 1) {
                room.debate = null;
                if (room.alive[result[0]]) room.alive[result[0]] = false;
                io.to(currentRoom).emit('chat message', `被投票處決的是：${result[0]}`);
                if (room.roles[result[0]] === 'idiot') io.to(currentRoom).emit('chat message', `他是白癡`);
                checkGameEnd(currentRoom);
        
                if (room.police === result) {
                    sendPolice(currentRoom, () => {
                        room.lastWord = result[0];
                        io.to(currentRoom).emit('talking time', { talking: result[0], phase: 'last word' });
                    });
                } else {
                    room.lastWord = result[0];
                    io.to(currentRoom).emit('talking time', { talking: result[0], phase: 'last word' });
                }
            } else {
                if (room.debate === null) {
                    room.debate = result;
                    room.debateIdx = 0;
                    io.to(currentRoom).emit('talking time', { talking: room.debate[room.debateIdx], phase: 'debate' });
                } else {
                    room.debate = null;
                    startNightPhase(currentRoom);
                }
            }
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
