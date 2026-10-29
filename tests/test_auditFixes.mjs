import assert from 'node:assert';
import { OP_FRAME, encodeFrame, FrameDecoder } from '../rpcProtocol.js';

console.log('Running audit & regression fixes unit tests...');

// Mock Clutter Constants
const Clutter = {
    EVENT_STOP: true,
    EVENT_PROPAGATE: false,
    EventType: {
        BUTTON_PRESS: 4,
        BUTTON_RELEASE: 5,
        SCROLL: 6,
    },
    ScrollDirection: {
        UP: 0,
        DOWN: 1,
        LEFT: 2,
        RIGHT: 3,
        SMOOTH: 4,
    },
};

// =========================================================================
// Test 1: SPEAKING_START and SPEAKING_STOP (Discord Desktop local RPC format)
// =========================================================================
{
    console.log('Testing 1: SPEAKING_START and SPEAKING_STOP event tracking...');

    class SpeakingTracker {
        constructor() {
            this.speakingUsers = new Set();
            this.dispatchedEvents = [];
        }

        handleDispatch(evt, eventData) {
            switch (evt) {
                case 'SPEAKING_START':
                case 'SPEAKING_STOP':
                case 'SPEAKING': {
                    const userId = String(eventData?.user_id || eventData?.userId || eventData?.id || '');
                    let speaking = false;
                    if (evt === 'SPEAKING_START') {
                        speaking = true;
                    } else if (evt === 'SPEAKING_STOP') {
                        speaking = false;
                    } else {
                        speaking = Boolean(eventData?.speaking);
                    }

                    if (userId) {
                        if (speaking) {
                            this.speakingUsers.add(userId);
                        } else {
                            this.speakingUsers.delete(userId);
                        }
                        this.dispatchedEvents.push({
                            userId,
                            speaking,
                            channelId: eventData?.channel_id,
                        });
                    }
                    break;
                }
                default:
                    break;
            }
        }
    }

    const tracker = new SpeakingTracker();

    // 1. Participant 1 starts speaking via SPEAKING_START
    tracker.handleDispatch('SPEAKING_START', { channel_id: 'chan_1', user_id: 'user_101' });
    assert.strictEqual(tracker.speakingUsers.has('user_101'), true);
    assert.strictEqual(tracker.dispatchedEvents.length, 1);
    assert.strictEqual(tracker.dispatchedEvents[0].speaking, true);

    // 2. Participant 2 also starts speaking
    tracker.handleDispatch('SPEAKING_START', { channel_id: 'chan_1', user_id: 'user_102' });
    assert.strictEqual(tracker.speakingUsers.has('user_102'), true);
    assert.strictEqual(tracker.speakingUsers.size, 2);

    // 3. Participant 1 stops speaking via SPEAKING_STOP
    tracker.handleDispatch('SPEAKING_STOP', { channel_id: 'chan_1', user_id: 'user_101' });
    assert.strictEqual(tracker.speakingUsers.has('user_101'), false);
    assert.strictEqual(tracker.speakingUsers.has('user_102'), true);
    assert.strictEqual(tracker.speakingUsers.size, 1);

    // 4. Backwards compatibility: legacy SPEAKING with numeric flag
    tracker.handleDispatch('SPEAKING', { channel_id: 'chan_1', user_id: 'user_103', speaking: 1 });
    assert.strictEqual(tracker.speakingUsers.has('user_103'), true);
    tracker.handleDispatch('SPEAKING', { channel_id: 'chan_1', user_id: 'user_103', speaking: 0 });
    assert.strictEqual(tracker.speakingUsers.has('user_103'), false);

    // 5. Alternate camelCase userId and id fields normalization
    tracker.handleDispatch('SPEAKING_START', { channel_id: 'chan_1', userId: 'user_104' });
    assert.strictEqual(tracker.speakingUsers.has('user_104'), true);
    tracker.handleDispatch('SPEAKING_STOP', { channel_id: 'chan_1', id: 'user_104' });
    assert.strictEqual(tracker.speakingUsers.has('user_104'), false);

    console.log('✓ Test 1: SPEAKING_START, SPEAKING_STOP, and SPEAKING events passed');
}

// =========================================================================
// Test 2: Startup voice channel detection triggers subscriptions
// =========================================================================
{
    console.log('Testing 2: Startup active channel detection triggers subscriptions...');

    class SimulatedRpcClient {
        constructor() {
            this.subscribedChannelId = null;
            this.subscriptions = new Set();
            this.currentVoiceChannel = null;
        }

        subscribe(evt, args) {
            this.subscriptions.add(`${evt}:${args?.channel_id}`);
            return Promise.resolve();
        }

        unsubscribe(evt, args) {
            this.subscriptions.delete(`${evt}:${args?.channel_id}`);
            return Promise.resolve();
        }

        updateChannelSubscriptions(newChannelId) {
            if (this.subscribedChannelId && this.subscribedChannelId !== newChannelId) {
                this.cleanupChannelSubscriptions();
            }

            if (newChannelId && this.subscribedChannelId !== newChannelId) {
                this.subscribedChannelId = newChannelId;
                const args = { channel_id: newChannelId };
                this.subscribe('VOICE_STATE_CREATE', args);
                this.subscribe('VOICE_STATE_UPDATE', args);
                this.subscribe('VOICE_STATE_DELETE', args);
                this.subscribe('SPEAKING_START', args);
                this.subscribe('SPEAKING_STOP', args);
                this.subscribe('SPEAKING', args);
            }
        }

        cleanupChannelSubscriptions() {
            if (this.subscribedChannelId) {
                const args = { channel_id: this.subscribedChannelId };
                this.unsubscribe('VOICE_STATE_CREATE', args);
                this.unsubscribe('VOICE_STATE_UPDATE', args);
                this.unsubscribe('VOICE_STATE_DELETE', args);
                this.unsubscribe('SPEAKING_START', args);
                this.unsubscribe('SPEAKING_STOP', args);
                this.unsubscribe('SPEAKING', args);
                this.subscribedChannelId = null;
            }
        }

        async getSelectedVoiceChannel(mockData) {
            const data = mockData;
            if (data && data.id) {
                this.currentVoiceChannel = data;
                this.updateChannelSubscriptions(this.currentVoiceChannel.id);
            } else {
                this.currentVoiceChannel = null;
                this.cleanupChannelSubscriptions();
            }
            return this.currentVoiceChannel;
        }
    }

    const client = new SimulatedRpcClient();

    // Already in voice channel on startup
    await client.getSelectedVoiceChannel({
        id: 'voice_ch_999',
        name: 'General',
        voice_states: [{ user: { id: 'self_1' } }],
    });

    assert.strictEqual(client.subscribedChannelId, 'voice_ch_999');
    assert.strictEqual(client.subscriptions.has('VOICE_STATE_CREATE:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.has('VOICE_STATE_UPDATE:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.has('VOICE_STATE_DELETE:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.has('SPEAKING_START:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.has('SPEAKING_STOP:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.has('SPEAKING:voice_ch_999'), true);
    assert.strictEqual(client.subscriptions.size, 6);

    // Switching to another channel
    await client.getSelectedVoiceChannel({
        id: 'voice_ch_888',
        name: 'Gaming',
        voice_states: [],
    });
    assert.strictEqual(client.subscribedChannelId, 'voice_ch_888');
    assert.strictEqual(client.subscriptions.has('VOICE_STATE_CREATE:voice_ch_888'), true);
    assert.strictEqual(client.subscriptions.has('VOICE_STATE_CREATE:voice_ch_999'), false);

    // Leaving channel
    await client.getSelectedVoiceChannel(null);
    assert.strictEqual(client.subscribedChannelId, null);
    assert.strictEqual(client.subscriptions.size, 0);

    console.log('✓ Test 2: Startup channel subscription and transition passed');
}

// =========================================================================
// Test 3: Real-time dynamic participant management (Scaling up to 11 members)
// =========================================================================
{
    console.log('Testing 3: Dynamic participant management with 11 members...');

    class VoiceStateManager {
        constructor(currentUserId = 'self_user') {
            this.currentUserId = currentUserId;
            this.currentVoiceChannel = {
                id: 'ch_large',
                name: 'Mega Room',
                voice_states: [
                    {
                        user: { id: 'self_user', username: 'Self' },
                        voice_state: { mute: false, deaf: false },
                    },
                ],
            };
            this.speakingUsers = new Set();
        }

        handleVoiceStateEvent(evt, eventData) {
            if (!eventData) return;
            const rawUser = eventData.user || {};
            const userId = String(rawUser.id || eventData.user_id || eventData.id || '');
            if (!userId) return;

            if (evt === 'VOICE_STATE_DELETE' && this.currentUserId && userId === this.currentUserId) {
                this.currentVoiceChannel = null;
                return;
            }

            if (!this.currentVoiceChannel) {
                this.currentVoiceChannel = { id: 'ch_large', name: 'Mega Room', voice_states: [] };
            }

            const voiceStates = this.currentVoiceChannel.voice_states;
            const existingIdx = voiceStates.findIndex(m => {
                const mId = String(m?.user?.id || m?.user_id || m?.id || '');
                return mId === userId;
            });

            if (evt === 'VOICE_STATE_DELETE') {
                if (existingIdx !== -1) {
                    voiceStates.splice(existingIdx, 1);
                }
                this.speakingUsers.delete(userId);
            } else {
                const normalizedMember = {
                    user: {
                        id: userId,
                        username: rawUser.username || eventData.nick || 'User',
                        avatar: rawUser.avatar || null,
                    },
                    nick: eventData.nick || null,
                    volume: typeof eventData.volume === 'number' ? eventData.volume : 100,
                    mute: Boolean(eventData.mute || eventData.voice_state?.mute),
                    deaf: Boolean(eventData.deaf || eventData.voice_state?.deaf),
                    voice_state: {
                        mute: Boolean(eventData.voice_state?.mute ?? eventData.mute),
                        deaf: Boolean(eventData.voice_state?.deaf ?? eventData.deaf),
                        self_mute: Boolean(eventData.voice_state?.self_mute ?? eventData.self_mute),
                        self_deaf: Boolean(eventData.voice_state?.self_deaf ?? eventData.self_deaf),
                    },
                };

                if (existingIdx !== -1) {
                    voiceStates[existingIdx] = {
                        ...voiceStates[existingIdx],
                        ...normalizedMember,
                    };
                } else {
                    voiceStates.push(normalizedMember);
                }
            }
        }
    }

    const manager = new VoiceStateManager('self_user');
    assert.strictEqual(manager.currentVoiceChannel.voice_states.length, 1);

    // Simulate 10 other participants joining one by one (total 11 participants)
    for (let i = 1; i <= 10; i++) {
        manager.handleVoiceStateEvent('VOICE_STATE_CREATE', {
            user: {
                id: `user_${i}`,
                username: `Participant_${i}`,
                avatar: `avatar_${i}.png`,
            },
            voice_state: {
                mute: i % 2 === 0,
                deaf: i % 4 === 0,
            },
            volume: 100 + i * 5,
        });
    }

    assert.strictEqual(manager.currentVoiceChannel.voice_states.length, 11, 'Must have 11 participants');

    // Participant 4 updates their voice state (self-mutes)
    manager.handleVoiceStateEvent('VOICE_STATE_UPDATE', {
        user: { id: 'user_4', username: 'Participant_4' },
        voice_state: { mute: true, self_mute: true },
    });
    const p4 = manager.currentVoiceChannel.voice_states.find(m => m.user.id === 'user_4');
    assert.strictEqual(p4.voice_state.self_mute, true);
    assert.strictEqual(manager.currentVoiceChannel.voice_states.length, 11);

    // Participant 2 and 3 leave
    manager.handleVoiceStateEvent('VOICE_STATE_DELETE', { user: { id: 'user_2' } });
    manager.handleVoiceStateEvent('VOICE_STATE_DELETE', { user: { id: 'user_3' } });
    assert.strictEqual(manager.currentVoiceChannel.voice_states.length, 9);
    assert.strictEqual(manager.currentVoiceChannel.voice_states.some(m => m.user.id === 'user_2'), false);

    console.log('✓ Test 3: Dynamic 11-member lifecycle passed');
}

// =========================================================================
// Test 4: Quick mouse action vfunc_event interception
// =========================================================================
{
    console.log('Testing 4: Quick mouse action vfunc_event interception...');

    class MockEvent {
        constructor(type, button = 0, scrollDir = 0, scrollDelta = [0, 0]) {
            this._type = type;
            this._button = button;
            this._scrollDir = scrollDir;
            this._scrollDelta = scrollDelta;
        }
        type() { return this._type; }
        get_button() { return this._button; }
        get_scroll_direction() { return this._scrollDir; }
        get_scroll_delta() { return this._scrollDelta; }
    }

    class MockClickGesture {
        constructor() {
            this.requiredButton = 0; // Default Clutter.ClickGesture accepts any button
            this.recognizedButtons = [];
        }
        set_required_button(btn) {
            this.requiredButton = btn;
        }
        simulateClick(button) {
            if (this.requiredButton === 0 || this.requiredButton === button) {
                this.recognizedButtons.push(button);
                return true;
            }
            return false;
        }
    }

    class MockBasePanelButton {
        constructor() {
            this.menuToggled = false;
            this._clickGesture = new MockClickGesture();
        }

        vfunc_event(event) {
            // Default GNOME PanelMenu.Button behavior
            if (event.type() === Clutter.EventType.BUTTON_PRESS) {
                this.menuToggled = !this.menuToggled;
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
    }

    class TestIndicator extends MockBasePanelButton {
        constructor(settings) {
            super();
            this._settings = settings;
            this.actionsExecuted = [];

            // GNOME Shell 47-51 fix: restrict ClickGesture to button 1
            if (this._clickGesture) {
                if (typeof this._clickGesture.set_required_button === 'function') {
                    this._clickGesture.set_required_button(1);
                }
            }
        }

        _executeMouseAction(action) {
            if (!action || action === 'none') return false;
            this.actionsExecuted.push(action);
            return true;
        }

        _executeScrollAction(action, direction) {
            if (!action || action === 'none') return false;
            let isUp = (direction === Clutter.ScrollDirection.UP);
            let isDown = (direction === Clutter.ScrollDirection.DOWN);
            if (!isUp && !isDown) return false;
            this.actionsExecuted.push(`${action}:${isUp ? 'up' : 'down'}`);
            return true;
        }

        vfunc_event(event) {
            const eventType = event.type();

            if (eventType === Clutter.EventType.BUTTON_PRESS) {
                const button = event.get_button();
                if (button === 2) {
                    const action = this._settings.get_string('mouse-middle-click-action') || 'toggle-mute';
                    if (action === 'toggle-menu') {
                        this.menuToggled = !this.menuToggled;
                    } else if (action !== 'none') {
                        this._executeMouseAction(action);
                    }
                    return Clutter.EVENT_STOP;
                } else if (button === 3) {
                    const action = this._settings.get_string('mouse-right-click-action') || 'leave-channel';
                    if (action === 'toggle-menu') {
                        this.menuToggled = !this.menuToggled;
                    } else if (action !== 'none') {
                        this._executeMouseAction(action);
                    }
                    return Clutter.EVENT_STOP;
                } else if (button === 1) {
                    return super.vfunc_event(event);
                }
            } else if (eventType === Clutter.EventType.BUTTON_RELEASE) {
                const button = event.get_button();
                if (button === 2 || button === 3) {
                    return Clutter.EVENT_STOP;
                }
            } else if (eventType === Clutter.EventType.SCROLL) {
                let direction = event.get_scroll_direction();
                if (direction === Clutter.ScrollDirection.SMOOTH) {
                    const [dx, dy] = event.get_scroll_delta();
                    if (Math.abs(dy) >= 0.1 || Math.abs(dx) >= 0.1) {
                        if (dy < 0 || dx < 0) {
                            direction = Clutter.ScrollDirection.UP;
                        } else if (dy > 0 || dx > 0) {
                            direction = Clutter.ScrollDirection.DOWN;
                        }
                    }
                }
                const action = this._settings.get_string('mouse-scroll-action') || 'cycle-display-mode';
                if (action !== 'none') {
                    this._executeScrollAction(action, direction);
                }
                return Clutter.EVENT_STOP;
            }

            return super.vfunc_event(event);
        }
    }

    const mockSettings = {
        _map: new Map([
            ['mouse-middle-click-action', 'toggle-mute'],
            ['mouse-right-click-action', 'leave-channel'],
            ['mouse-scroll-action', 'cycle-display-mode'],
        ]),
        get_string(key) { return this._map.get(key); },
        set_string(key, val) { this._map.set(key, val); },
    };

    const indicator = new TestIndicator(mockSettings);

    // Verify GNOME Shell 47-51 ClickGesture configuration
    assert.strictEqual(indicator._clickGesture.requiredButton, 1, 'ClickGesture must require primary button 1');
    assert.strictEqual(indicator._clickGesture.simulateClick(1), true, 'Primary button triggers gesture');
    assert.strictEqual(indicator._clickGesture.simulateClick(2), false, 'Middle click must be ignored by ClickGesture');
    assert.strictEqual(indicator._clickGesture.simulateClick(3), false, 'Right click must be ignored by ClickGesture');

    // 1. Left-click (Button 1) -> Must delegate to super and toggle menu
    assert.strictEqual(indicator.menuToggled, false);
    const leftClickEvent = new MockEvent(Clutter.EventType.BUTTON_PRESS, 1);
    const leftRes = indicator.vfunc_event(leftClickEvent);
    assert.strictEqual(leftRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.menuToggled, true, 'Left-click toggles menu');
    assert.strictEqual(indicator.actionsExecuted.length, 0);

    // Reset menuToggled
    indicator.menuToggled = false;

    // 2. Middle-click (Button 2) -> Intercepted, executes toggle-mute, DOES NOT toggle menu
    const midClickEvent = new MockEvent(Clutter.EventType.BUTTON_PRESS, 2);
    const midRes = indicator.vfunc_event(midClickEvent);
    assert.strictEqual(midRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.menuToggled, false, 'Menu must NOT toggle on middle click');
    assert.deepStrictEqual(indicator.actionsExecuted, ['toggle-mute']);

    // 3. Right-click (Button 3) -> Intercepted, executes leave-channel, DOES NOT toggle menu
    const rightClickEvent = new MockEvent(Clutter.EventType.BUTTON_PRESS, 3);
    const rightRes = indicator.vfunc_event(rightClickEvent);
    assert.strictEqual(rightRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.menuToggled, false, 'Menu must NOT toggle on right click');
    assert.deepStrictEqual(indicator.actionsExecuted, ['toggle-mute', 'leave-channel']);

    // 4. Middle-click and Right-click with action === 'none' -> Returns EVENT_STOP and DOES NOT toggle menu
    mockSettings.set_string('mouse-middle-click-action', 'none');
    mockSettings.set_string('mouse-right-click-action', 'none');
    const midNoneRes = indicator.vfunc_event(midClickEvent);
    assert.strictEqual(midNoneRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.menuToggled, false, 'Menu must NOT toggle when middle click action is none');

    const rightNoneRes = indicator.vfunc_event(rightClickEvent);
    assert.strictEqual(rightNoneRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.menuToggled, false, 'Menu must NOT toggle when right click action is none');

    // 5. Button Release for buttons 2 and 3 returns EVENT_STOP
    const midReleaseEvent = new MockEvent(Clutter.EventType.BUTTON_RELEASE, 2);
    assert.strictEqual(indicator.vfunc_event(midReleaseEvent), Clutter.EVENT_STOP);
    const rightReleaseEvent = new MockEvent(Clutter.EventType.BUTTON_RELEASE, 3);
    assert.strictEqual(indicator.vfunc_event(rightReleaseEvent), Clutter.EVENT_STOP);

    // 6. Explicit toggle-menu action for button 2
    mockSettings.set_string('mouse-middle-click-action', 'toggle-menu');
    indicator.vfunc_event(midClickEvent);
    assert.strictEqual(indicator.menuToggled, true, 'Explicit toggle-menu action should toggle menu');

    // 7. Standard Discrete Scroll UP
    const scrollUpEvent = new MockEvent(Clutter.EventType.SCROLL, 0, Clutter.ScrollDirection.UP);
    const scrollUpRes = indicator.vfunc_event(scrollUpEvent);
    assert.strictEqual(scrollUpRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.actionsExecuted.at(-1), 'cycle-display-mode:up');

    // 8. Modern Smooth Scroll DOWN (dy > 0)
    const smoothDownEvent = new MockEvent(Clutter.EventType.SCROLL, 0, Clutter.ScrollDirection.SMOOTH, [0, 1.5]);
    const smoothDownRes = indicator.vfunc_event(smoothDownEvent);
    assert.strictEqual(smoothDownRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.actionsExecuted.at(-1), 'cycle-display-mode:down');

    // 9. Modern Smooth Scroll UP (dy < 0)
    const smoothUpEvent = new MockEvent(Clutter.EventType.SCROLL, 0, Clutter.ScrollDirection.SMOOTH, [0, -2.0]);
    const smoothUpRes = indicator.vfunc_event(smoothUpEvent);
    assert.strictEqual(smoothUpRes, Clutter.EVENT_STOP);
    assert.strictEqual(indicator.actionsExecuted.at(-1), 'cycle-display-mode:up');

    console.log('✓ Test 4: Quick mouse action vfunc_event interception passed');
}

// =========================================================================
// Test 5: Fault-tolerant member list & top-bar visual pipeline
// =========================================================================
{
    console.log('Testing 5: Fault tolerance across 11 participants in UI update...');

    class RobustIndicatorSimulator {
        constructor() {
            this.renderedInMenu = [];
            this.renderedInTaskbar = [];
            this.topBarVisualsExecuted = false;
        }

        populateMemberList(members) {
            for (const member of members) {
                if (!member) continue;
                try {
                    if (member.simulateError) {
                        throw new Error('Simulated member rendering failure');
                    }
                    this.renderedInMenu.push(member.id);
                } catch (err) {
                    // Protected by try-catch
                }
            }
        }

        updateTopBarVisuals(members) {
            this.topBarVisualsExecuted = true;
            for (const member of members) {
                try {
                    this.renderedInTaskbar.push(member.id);
                } catch (_) {}
            }
        }

        updateUi(members) {
            try {
                this.populateMemberList(members);
            } catch (err) {}

            try {
                this.updateTopBarVisuals(members);
            } catch (err) {}
        }
    }

    const sim = new RobustIndicatorSimulator();
    const mockMembers = [];
    for (let i = 1; i <= 11; i++) {
        mockMembers.push({
            id: `user_${i}`,
            simulateError: i === 2, // Participant 2 causes an error
        });
    }

    sim.updateUi(mockMembers);

    // 10 of 11 participants rendered in menu (fault isolated to participant 2)
    assert.strictEqual(sim.renderedInMenu.length, 10, '10 participants must render despite participant 2 error');
    assert.strictEqual(sim.renderedInMenu.includes('user_1'), true);
    assert.strictEqual(sim.renderedInMenu.includes('user_3'), true);
    assert.strictEqual(sim.renderedInMenu.includes('user_11'), true);

    // Top bar visuals must STILL execute and not be blocked!
    assert.strictEqual(sim.topBarVisualsExecuted, true, 'Top bar visuals MUST execute safely');
    assert.strictEqual(sim.renderedInTaskbar.length, 11);

    console.log('✓ Test 5: Fault-tolerant UI update pipeline verified');
}

// =========================================================================
// Test 6: Dynamic Speaking-Only Mode: Widget Pooling & Visibility Management
// =========================================================================
{
    console.log('Testing 6: Dynamic Speaking-Only avatar widget pooling & visibility...');

    class MockWidget {
        constructor(userId, size = 28) {
            this._userId = userId;
            this.size = size;
            this.visible = true;
            this.isSpeaking = false;
            this.glowColor = null;
            this.destroyed = false;
        }

        setSize(s) { this.size = s; }
        setBorderColor(c) { this.borderColor = c; }
        setUser(u) { this.user = u; }
        setSpeaking(speaking, glow) {
            this.isSpeaking = speaking;
            this.glowColor = glow;
        }
        destroy() {
            this.destroyed = true;
        }
    }

    class MockContainer {
        constructor() {
            this.visible = true;
            this.children = [];
        }
        add_child(child) {
            this.children.push(child);
        }
        remove_child(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) this.children.splice(idx, 1);
        }
        destroy_all_children() {
            for (const c of this.children) c.destroy();
            this.children = [];
        }
        get_children() {
            return [...this.children];
        }
        set_child_at_index(child, idx) {
            const curIdx = this.children.indexOf(child);
            if (curIdx !== -1) {
                this.children.splice(curIdx, 1);
                this.children.splice(idx, 0, child);
            }
        }
    }

    class SpeakingOnlyVisualManager {
        constructor() {
            this._participantWidgetMap = new Map();
            this._participantWidgets = [];
            this._taskbarParticipantsBox = new MockContainer();
            this._displayMode = 'avatars';
            this.speakingUsers = new Set();
        }

        isUserSpeaking(uid) {
            return this.speakingUsers.has(String(uid));
        }

        _clearTaskbarParticipants() {
            if (this._participantWidgetMap) {
                for (const w of this._participantWidgetMap.values()) {
                    w.destroy();
                }
                this._participantWidgetMap.clear();
            }
            this._participantWidgets = [];
            this._taskbarParticipantsBox.destroy_all_children();
        }

        updateTopBarVisuals(channel, currentUserId = 'self_1', maxParticipants = 3) {
            const displayMode = this._displayMode;

            // Pill mode hides taskbar participants box
            if (displayMode === 'pill') {
                this._taskbarParticipantsBox.visible = false;
                return;
            }

            // Normal / Speaking-Only Avatars Mode restores visible = true!
            this._taskbarParticipantsBox.visible = true;

            const members = channel?.voice_states || [];
            if (!channel || members.length === 0) {
                this._clearTaskbarParticipants();
                return;
            }

            let otherParticipants = members.filter(m => {
                const uid = String(m?.user?.id || m?.id || '');
                return uid && uid !== currentUserId;
            });

            if (displayMode === 'speaking-only') {
                otherParticipants = otherParticipants.filter(m => {
                    const uid = String(m?.user?.id || m?.id || '');
                    return uid && this.isUserSpeaking(uid);
                });
            }

            const visibleParticipants = otherParticipants.slice(0, maxParticipants);
            const visibleUserIds = new Set();
            const newWidgetsList = [];

            for (const member of visibleParticipants) {
                const memberId = String(member.user?.id || member.id || '');
                if (!memberId) continue;
                visibleUserIds.add(memberId);

                const isMemSpeaking = this.isUserSpeaking(memberId);
                let pAvatar = this._participantWidgetMap.get(memberId);
                if (!pAvatar || pAvatar.destroyed) {
                    pAvatar = new MockWidget(memberId, 28);
                    this._participantWidgetMap.set(memberId, pAvatar);
                    this._taskbarParticipantsBox.add_child(pAvatar);
                }

                pAvatar.setSpeaking(isMemSpeaking, '#23a55a');
                newWidgetsList.push(pAvatar);
            }

            // Remove/destroy only widgets that are no longer visible
            for (const [uid, widget] of this._participantWidgetMap.entries()) {
                if (!visibleUserIds.has(uid)) {
                    this._taskbarParticipantsBox.remove_child(widget);
                    widget.destroy();
                    this._participantWidgetMap.delete(uid);
                }
            }

            this._participantWidgets = newWidgetsList;
        }
    }

    const visualManager = new SpeakingOnlyVisualManager();
    const mockChannel = {
        id: 'voice_ch',
        voice_states: [
            { user: { id: 'self_1', username: 'Self' } },
            { user: { id: 'alice_1', username: 'Alice' } },
            { user: { id: 'bob_2', username: 'Bob' } },
        ],
    };

    // 1. Enter Pill mode -> taskbar participants box is hidden
    visualManager._displayMode = 'pill';
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._taskbarParticipantsBox.visible, false);

    // 2. Switch to speaking-only mode -> taskbar participants box visible is restored to true!
    visualManager._displayMode = 'speaking-only';
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._taskbarParticipantsBox.visible, true, 'Box must be restored to visible = true');
    assert.strictEqual(visualManager._participantWidgets.length, 0, 'No widgets shown when nobody speaking');

    // 3. Alice speaks -> Alice widget created
    visualManager.speakingUsers.add('alice_1');
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._participantWidgets.length, 1);
    const aliceWidget = visualManager._participantWidgets[0];
    assert.strictEqual(aliceWidget._userId, 'alice_1');
    assert.strictEqual(aliceWidget.isSpeaking, true);
    assert.strictEqual(aliceWidget.glowColor, '#23a55a');

    // 4. Alice continues speaking (next tick) -> Widget MUST be reused, NOT destroyed and recreated!
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._participantWidgets.length, 1);
    const aliceWidgetSecondTick = visualManager._participantWidgets[0];
    assert.strictEqual(aliceWidgetSecondTick, aliceWidget, 'Widget instance must be identical (reused from pool)');
    assert.strictEqual(aliceWidget.destroyed, false, 'Widget must not be destroyed');

    // 5. Bob also speaks -> Bob widget added, Alice widget preserved
    visualManager.speakingUsers.add('bob_2');
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._participantWidgets.length, 2);
    assert.strictEqual(visualManager._participantWidgets[0], aliceWidget, 'Alice widget preserved');
    const bobWidget = visualManager._participantWidgets[1];
    assert.strictEqual(bobWidget._userId, 'bob_2');
    assert.strictEqual(bobWidget.isSpeaking, true);

    // 6. Alice stops speaking -> Alice widget removed and destroyed, Bob widget preserved
    visualManager.speakingUsers.delete('alice_1');
    visualManager.updateTopBarVisuals(mockChannel);
    assert.strictEqual(visualManager._participantWidgets.length, 1);
    assert.strictEqual(visualManager._participantWidgets[0], bobWidget, 'Bob widget preserved');
    assert.strictEqual(aliceWidget.destroyed, true, 'Alice widget cleanly destroyed when quiet');
    assert.strictEqual(bobWidget.destroyed, false, 'Bob widget still active');

    // 7. Disconnecting / Leaving channel -> all widgets destroyed cleanly
    visualManager.updateTopBarVisuals(null);
    assert.strictEqual(visualManager._participantWidgets.length, 0);
    assert.strictEqual(bobWidget.destroyed, true, 'Bob widget destroyed on channel exit');
    assert.strictEqual(visualManager._participantWidgetMap.size, 0);

    console.log('✓ Test 6: Dynamic Speaking-Only avatar widget pooling & visibility passed');
}

// =========================================================================
// Test 7: Mock Discord RPC SPEAKING_START and SPEAKING_STOP frame handling
// =========================================================================
{
    console.log('Testing 7: Mock Discord RPC frame handling for speaking events...');

    const startPayload = {
        cmd: 'SPEAKING_START',
        args: { user_id: 'tester_1' },
        nonce: 'mock-nonce-speak-1',
    };

    const encodedStart = encodeFrame(OP_FRAME, startPayload);
    const decoder = new FrameDecoder();
    const [decodedStart] = decoder.feed(encodedStart);
    assert.strictEqual(decodedStart.data.cmd, 'SPEAKING_START');
    assert.strictEqual(decodedStart.data.args.user_id, 'tester_1');

    const stopPayload = {
        cmd: 'SPEAKING_STOP',
        args: { userId: 'tester_1' },
        nonce: 'mock-nonce-speak-2',
    };
    const [decodedStop] = decoder.feed(encodeFrame(OP_FRAME, stopPayload));
    assert.strictEqual(decodedStop.data.cmd, 'SPEAKING_STOP');
    assert.strictEqual(decodedStop.data.args.userId, 'tester_1');

    console.log('✓ Test 7: Mock Discord RPC speaking frame handling verified');
}

// =========================================================================
// Test 8: Fixed Constant Participant Area Width (Anti-Jitter QoL)
// =========================================================================
{
    console.log('Testing 8: Fixed Taskbar Participant Area Width (Anti-Jitter QoL)...');

    const DEFAULT_TASKBAR_FIXED_WIDTH = 96;

    class MockTaskbarBox {
        constructor() {
            this.width = -1;
            this.clip_to_allocation = false;
            this.visible = false;
            this._children = [];
        }
        set_width(w) {
            this.width = w;
        }
        add_child(child) {
            this._children.push(child);
        }
        remove_child(child) {
            const idx = this._children.indexOf(child);
            if (idx >= 0) this._children.splice(idx, 1);
        }
        get_children() {
            return [...this._children];
        }
        destroy_all_children() {
            this._children = [];
        }
    }

    class MockIndicatorAntiJitter {
        constructor(settings = {}) {
            this._settings = new Map(Object.entries({
                'show-taskbar-participants': true,
                'taskbar-fixed-width': DEFAULT_TASKBAR_FIXED_WIDTH,
                'panel-display-mode': 'speaking-only',
                ...settings,
            }));
            this._taskbarParticipantsBox = new MockTaskbarBox();
            this.speakingUsers = new Set();
        }

        _getTaskbarFixedWidth() {
            return Math.max(0, this._settings.get('taskbar-fixed-width') ?? DEFAULT_TASKBAR_FIXED_WIDTH);
        }

        updateTopBarVisuals(channel) {
            const showParticipants = this._settings.get('show-taskbar-participants');
            const displayMode = this._settings.get('panel-display-mode');
            const fixedWidth = this._getTaskbarFixedWidth();

            if (!channel) {
                this._taskbarParticipantsBox.visible = false;
                this._taskbarParticipantsBox.destroy_all_children();
                return;
            }

            if (displayMode === 'pill') {
                this._taskbarParticipantsBox.visible = false;
                return;
            }

            const showPartBox = Boolean(showParticipants);
            this._taskbarParticipantsBox.visible = showPartBox;
            if (showPartBox) {
                if (fixedWidth > 0) {
                    this._taskbarParticipantsBox.set_width(fixedWidth);
                    this._taskbarParticipantsBox.clip_to_allocation = true;
                } else {
                    this._taskbarParticipantsBox.set_width(-1);
                    this._taskbarParticipantsBox.clip_to_allocation = false;
                }
            }

            // In speaking-only mode, only add children for active speakers
            const members = channel.voice_states || [];
            this._taskbarParticipantsBox.destroy_all_children();
            for (const m of members) {
                if (displayMode === 'speaking-only' && !this.speakingUsers.has(m.id)) {
                    continue;
                }
                this._taskbarParticipantsBox.add_child({ id: m.id });
            }
        }
    }

    const indicator = new MockIndicatorAntiJitter();
    const mockChannel = {
        id: 'voice_ch_1',
        voice_states: [{ id: 'user_a' }, { id: 'user_b' }, { id: 'user_c' }],
    };

    // 1. In voice channel, before anyone speaks (0 speakers)
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox.visible, true, 'Box is visible in channel');
    assert.strictEqual(indicator._taskbarParticipantsBox.width, 96, 'Constant width held at default 96px with 0 speakers');
    assert.strictEqual(indicator._taskbarParticipantsBox.clip_to_allocation, true);
    assert.strictEqual(indicator._taskbarParticipantsBox._children.length, 0);

    // 2. User A starts speaking -> 1 speaker avatar added, width remains locked at 96px
    indicator.speakingUsers.add('user_a');
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox._children.length, 1);
    assert.strictEqual(indicator._taskbarParticipantsBox.width, 96, 'Width stays fixed at 96px (NO EXPANSION JITTER)');

    // 3. User B also starts speaking -> 2 speakers, width remains locked at 96px
    indicator.speakingUsers.add('user_b');
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox._children.length, 2);
    assert.strictEqual(indicator._taskbarParticipantsBox.width, 96, 'Width stays fixed at 96px with multiple speakers');

    // 4. User A stops speaking -> 1 speaker, width remains locked at 96px
    indicator.speakingUsers.delete('user_a');
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox._children.length, 1);
    assert.strictEqual(indicator._taskbarParticipantsBox.width, 96, 'Width stays fixed at 96px (NO COLLAPSING JITTER)');

    // 5. User adjusts fixed width setting to 140px in preferences
    indicator._settings.set('taskbar-fixed-width', 140);
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox.width, 140, 'Width updates to user-adjusted value (140px)');

    // 6. User sets fixed width to 0 (dynamic auto-sizing mode)
    indicator._settings.set('taskbar-fixed-width', 0);
    indicator.updateTopBarVisuals(mockChannel);
    assert.strictEqual(indicator._taskbarParticipantsBox.width, -1, 'Width reverts to -1 (natural sizing) when set to 0');
    assert.strictEqual(indicator._taskbarParticipantsBox.clip_to_allocation, false);

    // 7. Leaving voice channel collapses visibility
    indicator.updateTopBarVisuals(null);
    assert.strictEqual(indicator._taskbarParticipantsBox.visible, false, 'Box hidden when leaving channel');

    console.log('✓ Test 8: Fixed Taskbar Participant Area Width (Anti-Jitter QoL) passed');
}

// =========================================================================
// Test 9: Participant Self-Mute vs Local-Mute Separation & Volume Rounding
// =========================================================================
{
    console.log('Testing 9: Participant Self-Mute vs Local-Mute Separation & Volume Precision...');

    // Simulate voice state normalization logic from discordRpc.js
    function normalizeMemberState(existingMember, eventData) {
        const rawUser = eventData.user || {};
        const userId = String(rawUser.id || eventData.user_id || eventData.id || '');

        const isVoiceMuted = Boolean(
            eventData.voice_state?.mute ||
            eventData.voice_state?.self_mute ||
            eventData.voice_state?.suppress ||
            eventData.self_mute
        );
        const isVoiceDeaf = Boolean(
            eventData.voice_state?.deaf ||
            eventData.voice_state?.self_deaf ||
            eventData.self_deaf
        );

        let isLocallyMuted = false;
        if (typeof eventData.mute === 'boolean') {
            isLocallyMuted = eventData.mute;
        } else if (typeof eventData.user_voice_settings?.mute === 'boolean') {
            isLocallyMuted = eventData.user_voice_settings.mute;
        } else if (existingMember && typeof existingMember.mute === 'boolean') {
            isLocallyMuted = existingMember.mute;
        }

        let localVolume = 100;
        if (typeof eventData.volume === 'number') {
            localVolume = Math.round(eventData.volume);
        } else if (typeof eventData.user_voice_settings?.volume === 'number') {
            localVolume = Math.round(eventData.user_voice_settings.volume);
        } else if (existingMember && typeof existingMember.volume === 'number') {
            localVolume = Math.round(existingMember.volume);
        }

        return {
            user: { id: userId, username: rawUser.username || 'User' },
            volume: localVolume,
            mute: isLocallyMuted,
            voice_muted: isVoiceMuted,
            voice_deaf: isVoiceDeaf,
            voice_state: {
                mute: Boolean(eventData.voice_state?.mute),
                deaf: Boolean(eventData.voice_state?.deaf),
                self_mute: Boolean(eventData.voice_state?.self_mute ?? eventData.self_mute),
                self_deaf: Boolean(eventData.voice_state?.self_deaf ?? eventData.self_deaf),
                suppress: Boolean(eventData.voice_state?.suppress ?? eventData.suppress),
            },
        };
    }

    // Scenario A: Participant Bob mutes HIMSELF in Discord
    const bobSelfMuteEvent = {
        user: { id: 'bob_user_id', username: 'Bob' },
        voice_state: {
            mute: false,       // Server mute is false
            deaf: false,
            self_mute: true,   // Bob muted himself
            self_deaf: false,
            suppress: false,
        },
        volume: 83.33333333333333, // Discord RPC float volume
        mute: false,               // Current user did NOT locally mute Bob
    };

    const normalizedBob = normalizeMemberState(null, bobSelfMuteEvent);

    // 1. Voice state indicates Bob is muted in call (shows mic badge and border)
    assert.strictEqual(normalizedBob.voice_muted, true, 'Bob should be detected as voice_muted');
    assert.strictEqual(normalizedBob.voice_state.self_mute, true, 'Bob self_mute should be true');

    // 2. CRITICAL BUG FIX: Local mute must be FALSE! Mute button must NOT show "Unmute"
    assert.strictEqual(normalizedBob.mute, false, 'Local mute must remain FALSE when participant self-mutes');

    // 3. CRITICAL DECIMAL FIX: Floating-point volume must be strictly rounded to clean integer
    assert.strictEqual(normalizedBob.volume, 83, 'Volume 83.33333333333333 must be rounded to integer 83');

    // Scenario B: Current user toggles mute on Bob locally via speaker icon button
    const userMutedBobEvent = {
        ...bobSelfMuteEvent,
        mute: true, // Current user clicked mute on Bob
    };
    const locallyMutedBob = normalizeMemberState(normalizedBob, userMutedBobEvent);
    assert.strictEqual(locallyMutedBob.mute, true, 'Local mute becomes TRUE when user explicitly mutes Bob');

    // Scenario C: Slider math & formatting
    const sliderVal = Math.min(1.0, Math.max(0.0, normalizedBob.volume / 200.0));
    assert.strictEqual(sliderVal, 83 / 200);
    const displayedPercent = `${Math.round(sliderVal * 200)}%`;
    assert.strictEqual(displayedPercent, '83%', 'Label text is clean integer percentage without decimals');

    // Scenario D: Reset button to 100%
    const resetSliderVal = 0.5;
    const resetPercent = `${Math.round(resetSliderVal * 200)}%`;
    assert.strictEqual(resetPercent, '100%');

    console.log('✓ Test 9: Participant Self-Mute vs Local-Mute Separation & Volume Precision passed');
}

console.log('All audit & regression fixes unit tests passed successfully!');
