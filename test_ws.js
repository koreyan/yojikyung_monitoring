const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:9000');

ws.on('open', function open() {
  console.log('✅ Connected to Bridge');
});

ws.on('message', function incoming(data) {
  const payload = JSON.parse(data.toString());
  // console.log('📩 Received Packet:');
  // console.log(' Timestamp:', payload.timestamp);
  // console.log(' Count:', payload.count);
  // console.log(' First 3 sensors:');
  // payload.sensors.slice(0, 3).forEach(s => {
  //   console.log(`  - ID: 0x${s.id.toString(16).toUpperCase()}, M: ${s.m}, T: ${s.t}, I: ${s.i}, Value: ${s.value}`);
  // });
  process.exit(0); 
});

ws.on('error', function error(err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('⏱️ Timeout waiting for data');
  process.exit(1);
}, 5000);
