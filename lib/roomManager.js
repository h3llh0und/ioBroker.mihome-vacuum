'use strict';
let adapter = null;
let roomManager = null;
let i18n = null;

class RoomManager {
    constructor(adapterInstance, i18nInstance, Miio) {
        this.Miio = Miio;
        adapter = adapterInstance;
        i18n = i18nInstance;
        roomManager = this;
        this.stateRoomClean = {
            type: 'state',
            common: {
                name: i18n.cleanRoom,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                desc: 'Start Room Cleaning',
                smartName: i18n.cleanRooms
            },
            native: {}
        };
        this.stateRoomStatus = {
            type: 'state',
            common: {
                name: 'info',
                type: 'string',
                role: 'info',
                read: true,
                write: false,
                desc: 'Status of Cleaning'
            },
            native: {}
        };        
        adapter.setObject('rooms.loadRooms', {
            type: 'state',
            common: {
                name: i18n.loadRooms,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                desc: 'loads id\'s from stored rooms'
            },
            native: {}
        });
        adapter.setObject('rooms.multiRoomClean', {
            type: 'state',
            common: {
                name: i18n.cleanMultiRooms,
                type: 'boolean',
                role: 'button',
                read: false,
                write: true,
                desc: 'clean all rooms, which are connected to this datapoint'
            },
            native: {}
        });
        adapter.setObject('rooms.addRoom', {
            type: 'state',
            common: {
                name: i18n.addRoom,
                type: 'string',
                role: 'value',
                read: true,
                write: true,
                desc: 'add roos manual with map Index or zone coordinates'
            },
            native: {}
            },
            (err, obj) => obj && adapter.setForeignState(obj.id, i18n.addRoom, true));

        adapter.getStates(adapter.namespace + '.rooms.*.roomClean', (err, states) => {
            if (states) {
                for (let stateId in states) {
                    let id = stateId.replace('.roomClean', '.state');

                    adapter.setObjectNotExists(id, roomManager.stateRoomStatus, () =>
                        adapter.setForeignState(id, '', true));
                }
            }
        });
    }

    /** Parses the answer of get_room_mapping */
    processRoomMaping(response) {
        const rooms = {};
        let room;
        if (typeof response.result !== 'object') {
            return false;
        }

        for(let r in response.result.map_info) 
        {
            adapter.log.info('map: ' + r.name );

            let mapFlag = r.mapFlag;
            this.Miio.sendMessage('load_multi_map', new Array(mapFlag)).then(result => {
                adapter.log.info("rooms: " + result);
            });
        }

        /*
        for (let r in response.result) {
            room = response.result[r];
            rooms[room[1]] = room[0];
        }
        adapter.getChannelsOf('rooms', function(err, roomObjs) {
            for (let r in roomObjs) {
                let roomObj = roomObjs[r];
                let extRoomId = roomObj._id.split('.').pop();
                if (extRoomId.indexOf('manual_') === -1) {
                    room = rooms[extRoomId];
                    if (!room) {
                        adapter.setStateChanged(roomObj._id + '.mapIndex', i18n.notAvailable, true, (err,id,notChanged) => {
                            if (!notChanged){
                                adapter.log.info('room: ' + extRoomId + ' not mapped');
                                adapter.setState(roomObj._id + '.state', i18n.notAvailable, true);
                            }
                        });
                    } else {
                        room= parseInt(room,10);
                        adapter.setStateChanged(roomObj._id + '.mapIndex', room, true, (err,id,notChanged) => {
                            if (!notChanged){
                                adapter.log.info('room: ' + extRoomId + ' mapped with index ' + room);
                                adapter.setObjectNotExists(roomObj._id + '.roomClean', roomManager.stateRoomClean); // in former time this dp was deleted, so try to create if needed
                                adapter.setObjectNotExists(roomObj._id + '.state', roomManager.stateRoomStatus);
                                adapter.setState(roomObj._id + '.state', '', true);
                            }
                        });
                        delete rooms[extRoomId];
                    }
                }
            }
            for (let extRoomId in rooms) {
                adapter.getObject('rooms.' + extRoomId, function (err, roomObj) {
                    if (roomObj)
                        adapter.setStateChanged(roomObj._id + '.mapIndex', rooms[extRoomId], true);
                    else 
                        roomManager.createRoom(extRoomId, rooms[extRoomId]);
                });
            }
        });
        */
    }

    cleanRooms(mapIndexStates) {
        adapter.getForeignStates(mapIndexStates, function (err, states) {
            let mapIndex = [];
            let zones = [];
            let mapChannels= [];
            let zoneChannels= [];
            if (states) {
                for (let stateId in states) {
                    if (stateId.indexOf('.mapIndex') > 0) {
                        let val = states[stateId].val || 'invalid';
                        if (!isNaN(val))
                            mapIndex.indexOf(parseInt(val,10)) === -1 && mapIndex.push(val) && mapChannels.push(stateId.replace(/\.([^.]+)$/,''));
                        else if (val[0] === '[')
                             zones.indexOf(val) === -1 && zones.push(val) && zoneChannels.push(stateId.replace(/\.([^.]+)$/,''));
                        else
                            adapter.log.error('could not clean ' + stateId + ', because mapIndex/zone is invalid: ' + val)
                    } else
                        adapter.log.error('state must be .mapIndex for roomManager.cleanRooms ' + stateId)
                }
                if (mapIndex.length > 0) {
                    adapter.sendTo(adapter.namespace, 'cleanSegments', {segments: mapIndex, channels:mapChannels});
                }
                if (zones.length > 0) {
                    adapter.sendTo(adapter.namespace, 'cleanZone', {zones: zones, channels:zoneChannels})
                }
            }
        });
    }

    // search for assigned roomObjs or id on timer or other state
    cleanRoomsFromState(id){
        adapter.getForeignObjects(id, 'state', 'rooms', (err, states) => {
            if (states && states[id].native) {
                let mapIndex = [];
                if (states[id].native.channels) {
                    for (let i in states[id].native.channels) {
                        mapIndex.push(adapter.namespace.concat('.rooms.', states[id].native.channels[i], '.mapIndex'))
                    }
                }
                let rooms = '';
                for (let r in states[id].enums) {
                    rooms += r;
                }

                if (rooms.length > 0) {
                    roomManager.findMapIndexByRoom(rooms, states =>
                        roomManager.cleanRooms(mapIndex.concat(states)));
                } else if (mapIndex.length > 0) {
                    roomManager.cleanRooms(mapIndex);
                } else {
                    adapter.log.warn('no room found for ' + id)
                }
            }
        })
    }

    findMapIndexByRoom(rooms, callback) {
        adapter.getForeignObjects(adapter.namespace + '.rooms.*.mapIndex', 'state', 'rooms', (err, states) => {
            if (states) {
                let mapIndexStates = [];
                for (let stateId in states) {
                    for (let r in states[stateId].enums) {
                        if (rooms.indexOf(r) >= 0 && stateId.indexOf('.mapIndex') > 0) {// bug in js-controller 1.5, that not only mapIndex in states
                            mapIndexStates.push(stateId);
                        }
                    }
                }
                callback && callback(mapIndexStates);
            } 
        });
    }

    findChannelsByMapIndex(mapList, callback) {
        adapter.getStates(adapter.namespace + '.rooms.*.mapIndex', (err, states) => {
            let channels = [];
            if (states) {
                for (let stateId in states) {
                    if (mapList.indexOf(states[stateId].val) >= 0) {
                        channels.push(stateId.replace(/\.([^.]+)$/,''))
                    }
                }
            }
            callback && callback(channels)
        });
    }

    createRoom(roomId, mapIndex) {
        adapter.log.info('create new room: ' + roomId);
        adapter.createChannel('rooms', roomId, (err, roomObj) => {
            if (roomObj) {
                adapter.setObjectNotExists( roomObj.id + '.mapIndex', {
                    type: 'state',
                    common:
                    mapIndex[0] === '['
                        ? {
                            name: 'map zone',
                            type: 'string',
                            role: 'value',
                            read: false,
                            write: false,
                            desc: 'coordinates of map zone'
                        }
                        : {
                            name: 'map index',
                            type: 'number',
                            role: 'value',
                            read: false,
                            write: false,
                            desc: 'index of assigned map'
                        },
                    native: {}
                },
                    (err, obj) => adapter.setState(obj.id, mapIndex, true));

                adapter.setObjectNotExists(roomObj.id + '.roomClean', roomManager.stateRoomClean);
                adapter.setObjectNotExists(roomObj.id + '.state', roomManager.stateRoomStatus);
                adapter.getObject('control.fan_power', (err, obj) => {
                    obj && adapter.getState(obj._id, (err, comonState) => {
                        adapter.setObjectNotExists(roomObj.id + '.roomFanPower', {
                            type: 'state',
                            common: obj.common,
                            native: {}
                            },
                            (err, state) => adapter.setState(state.id, comonState.val, false));
                        }
                    );
                });
                adapter.getObject('control.water_box_mode', (err, obj) => {
                    obj && adapter.getState(obj._id, (err, comonState) => {
                        adapter.setObjectNotExists(roomObj.id + '.roomWaterBoxMode', {
                            type: 'state',
                            common: obj.common,
                            native: {}
                        },
                        (err, state) => adapter.setState(state.id, comonState.val, false));
                        
                    }
                    );
                });
            }
        });
    }
}
module.exports= RoomManager;