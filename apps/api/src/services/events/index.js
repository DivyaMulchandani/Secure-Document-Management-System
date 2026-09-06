'use strict';

const { EventEmitter } = require('events');

/**
 * STUB — Sprint 0.
 *
 * Minimal in-process event bus so P0 modules can already call
 * `events.emit('document.created', {...})` without waiting on a real
 * broker. P2/P3 subscribers (OCR, classification, notifications, ...)
 * attach listeners here in later sprints; nothing subscribes yet.
 */
class DomainEventBus extends EventEmitter {}

module.exports = new DomainEventBus();
