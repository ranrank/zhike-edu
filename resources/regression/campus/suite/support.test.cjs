const {test} = require('node:test');
const assert = require('node:assert/strict');
const {events, transcript} = require('./support.cjs');

test('SSE confirmation is a named event, not a kind field in its payload', () => {
  const raw = 'event:meta\r\ndata:{"conversationId":"c1"}\r\n\r\n' +
    'event:confirm\r\ndata:{"messageId":"m1","calls":[{"name":"enroll_course"}]}\r\n\r\n' +
    'event:done\r\ndata:[DONE]\r\n\r\n';
  const parsed = events(raw);
  assert.equal(parsed.length, 2);
  const confirmation = parsed.find(event => event.eventType === 'confirm');
  assert.equal(confirmation.calls[0].name, 'enroll_course');
  assert.equal(transcript(raw).conversationId, 'c1');
});

test('SSE parser keeps error states and final status without treating heartbeat as JSON', () => {
  const raw = ': heartbeat\n\nevent:block\ndata:{"kind":"tool","name":"enroll_course","status":"failed"}\n\n' +
    'event:finish\ndata:{"messageStatus":"NORMAL"}\n\nevent:done\ndata:[DONE]\n\n';
  const result = transcript(raw);
  assert.equal(result.failed[0].name, 'enroll_course');
  assert.equal(result.finish.messageStatus, 'NORMAL');
  assert.equal(result.completed.length, 0);
});
