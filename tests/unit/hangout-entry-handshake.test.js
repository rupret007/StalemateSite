// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createEntrySharing } from '../../r/45662413410ed051/lobby/entry-sharing.mjs';

describe('entry sharing during socket admission', () => {
    it('clears a source advertised by hello when the visitor opts out before welcome', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'rad-dad', send: (frame) => { sent.push(frame); return true; } });
        sharing.setSupported(true);
        expect(sharing.helloSource()).toBe('rad-dad');
        sharing.setEnabled(false); expect(sent).toEqual([]);
        sharing.joined(); expect(sent).toEqual([{ t: 'entry-source', source: '' }]);
        sharing.joined(); expect(sent).toHaveLength(1);
    });
    it('does not advertise an opted-out source on admission or reconnect', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'stalemate', enabled: false, send: (frame) => { sent.push(frame); return true; } });
        sharing.setSupported(true);
        expect(sharing.helloSource()).toBe(''); sharing.joined(); expect(sent).toEqual([]);
        sharing.disconnect(); sharing.setEnabled(true); sharing.setEnabled(false);
        sharing.setSupported(true); expect(sharing.helloSource()).toBe(''); sharing.joined(); expect(sent).toEqual([]);
    });
    it('reconciles the latest choice once and sends no source changes after disconnect', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'stalemate', send: (frame) => { sent.push(frame); return true; } });
        sharing.setSupported(true);
        sharing.helloSource(); sharing.setEnabled(false); sharing.setEnabled(true); sharing.joined(); expect(sent).toEqual([]);
        sharing.setEnabled(false); expect(sent).toEqual([{ t: 'entry-source', source: '' }]);
        sharing.disconnect(); sharing.setEnabled(true); expect(sent).toHaveLength(1);
        sharing.setSupported(true); expect(sharing.helloSource()).toBe('stalemate'); sharing.joined(); expect(sent).toHaveLength(1);
    });
    it('keeps rejected sends pending and never substitutes an unregistered source', () => {
        const sent = []; let available = false;
        const sharing = createEntrySharing({ source: 'rad-dad', send: (frame) => { if (available) sent.push(frame); return available; } });
        sharing.setSupported(true);
        sharing.helloSource(); sharing.setEnabled(false); sharing.joined(); expect(sent).toEqual([]);
        available = true; sharing.joined(); expect(sent).toEqual([{ t: 'entry-source', source: '' }]);
        const neutral = createEntrySharing({ source: 'owner', send: () => { throw Error('Unknown source should remain neutral'); } });
        expect(neutral.helloSource()).toBe(''); neutral.joined(); neutral.setEnabled(false);
    });
    it('requires a fresh capability after reconnect and never sends a new frame to a legacy server', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'rad-dad', send: (frame) => { sent.push(frame); return true; } });
        expect(sharing.helloSource()).toBe('rad-dad'); sharing.setEnabled(false); sharing.joined();
        expect(sent).toEqual([]);
        sharing.setSupported(true); expect(sent).toEqual([{ t: 'entry-source', source: '' }]);
        sharing.disconnect(); sharing.setEnabled(true); sharing.helloSource(); sharing.setEnabled(false); sharing.joined();
        expect(sent).toHaveLength(1);
    });
    it('does not treat a queued privacy update as confirmation and reconciles rapid changes in order', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'stalemate', enabled: false, send: frame => { sent.push(frame); return true; } });
        sharing.setSupported(true); sharing.helloSource(); sharing.joined();
        sharing.setEnabled(true);
        expect(sharing.snapshot()).toMatchObject({ state: 'pending', source: '', requested: 'stalemate' });
        sharing.setEnabled(false);
        expect(sharing.canSend()).toBe(false);
        expect(sent).toEqual([{ t: 'entry-source', source: 'stalemate' }]);
        sharing.acknowledge({ source: 'stalemate', accepted: true });
        expect(sent).toEqual([{ t: 'entry-source', source: 'stalemate' }, { t: 'entry-source', source: '' }]);
        expect(sharing.canSend()).toBe(false);
        sharing.acknowledge({ source: '', accepted: true });
        expect(sharing.snapshot()).toMatchObject({ state: 'confirmed', source: '', requested: '' });
        expect(sharing.canSend()).toBe(true);
        sharing.acknowledge({ source: 'stalemate', accepted: true });
        expect(sharing.snapshot().source).toBe('');
    });
    it('shows rejection honestly without a retry loop and accepts the earlier source protocol acknowledgement', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'rad-dad', send: frame => { sent.push(frame); return true; } });
        sharing.setSupported(true); sharing.helloSource(); sharing.joined(); sharing.setEnabled(false);
        sharing.acknowledge({ source: 'rad-dad', accepted: false });
        expect(sharing.snapshot()).toMatchObject({ state: 'rejected', source: 'rad-dad', requested: '' });
        expect(sharing.canSend()).toBe(false); expect(sent).toHaveLength(1);
        sharing.setEnabled(false); expect(sent).toHaveLength(2);
        sharing.acknowledge({ source: '' });
        expect(sharing.canSend()).toBe(true); expect(sharing.snapshot().state).toBe('confirmed');
        sharing.disconnect(); sharing.acknowledge({ source: 'rad-dad' });
        expect(sharing.snapshot()).toMatchObject({ state: 'offline', source: null });
    });
    it('accepts a rejected in-flight share as confirmation of a newer hidden choice', () => {
        const sent = [];
        const sharing = createEntrySharing({ source: 'stalemate', enabled: false, send: frame => { sent.push(frame); return true; } });
        sharing.setSupported(true); sharing.helloSource(); sharing.joined();
        sharing.setEnabled(true); sharing.setEnabled(false);
        expect(sharing.canSend()).toBe(false);
        sharing.acknowledge({ source: '', accepted: false });
        expect(sharing.snapshot()).toMatchObject({ state: 'confirmed', source: '', requested: '' });
        expect(sharing.canSend()).toBe(true); expect(sent).toHaveLength(1);
    });
});
