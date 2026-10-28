import assert from 'node:assert';

console.log('Running participant lifecycle & cleanup unit tests...');

// Mock Clutter/St Actor classes for testing lifecycle
class MockActor {
    constructor() {
        this.destroyed = false;
        this.visible = true;
        this.text = '';
        this._children = [];
    }

    add_child(child) {
        this._children.push(child);
    }

    get_children() {
        return [...this._children];
    }

    destroy_all_children() {
        for (const child of this._children) {
            child.destroy();
        }
        this._children = [];
    }

    destroy() {
        this.destroyed = true;
        this.destroy_all_children();
    }
}

class MockAvatarWidget extends MockActor {
    constructor(size, options = {}) {
        super();
        this.size = size;
        this.borderColor = options.borderColor || 'transparent';
        this.user = null;
    }

    setUser(user) {
        this.user = user;
    }

    setBorderColor(color) {
        this.borderColor = color;
    }
}

// Simulated indicator participant lifecycle logic
class SimulatedIndicator {
    constructor() {
        this._participantWidgets = [];
        this._taskbarParticipantsBox = new MockActor();
        this._taskbarOverflowLabel = new MockActor();
        this._taskbarAvatar = new MockAvatarWidget(28);
        this._countLabel = new MockActor();
    }

    _clearTaskbarParticipants() {
        if (this._participantWidgets) {
            for (const w of this._participantWidgets) {
                try {
                    w.destroy();
                } catch (_) {}
            }
        }
        this._participantWidgets = [];
        if (this._taskbarParticipantsBox) {
            try {
                const children = this._taskbarParticipantsBox.get_children();
                if (children) {
                    for (const c of children) {
                        try {
                            c.destroy();
                        } catch (_) {}
                    }
                }
            } catch (_) {}
            try {
                this._taskbarParticipantsBox.destroy_all_children();
            } catch (_) {}
        }
        if (this._taskbarOverflowLabel) {
            this._taskbarOverflowLabel.text = '';
            this._taskbarOverflowLabel.visible = false;
        }
    }

    updateVoiceState({ isConnected, isAuthenticated, channel, currentUser, maxParticipants = 3, showParticipants = true }) {
        if (!isConnected || !isAuthenticated || !channel || !channel.id) {
            this._taskbarAvatar.setBorderColor('transparent');
            this._countLabel.text = '';
            this._clearTaskbarParticipants();
            return;
        }

        const members = channel.voice_states || [];
        this._clearTaskbarParticipants();

        if (showParticipants && members.length > 0) {
            const currentUserId = currentUser?.id;
            const otherParticipants = members.filter(m => m.user && (!currentUserId || m.user.id !== currentUserId));
            const visible = otherParticipants.slice(0, maxParticipants);
            const remaining = otherParticipants.length - visible.length;

            for (const member of visible) {
                const isMuted = Boolean(member.voice_state?.mute || member.voice_state?.self_mute);
                const isDeaf = Boolean(member.voice_state?.deaf || member.voice_state?.self_deaf);
                const color = isDeaf ? '#f0b232' : (isMuted ? '#f23f43' : '#23a55a');

                const widget = new MockAvatarWidget(28, { borderColor: color });
                widget.setUser(member.user);
                this._participantWidgets.push(widget);
                this._taskbarParticipantsBox.add_child(widget);
            }

            if (remaining > 0) {
                this._taskbarOverflowLabel.text = `+${remaining}`;
                this._taskbarOverflowLabel.visible = true;
            }
        }
    }
}

// Test 1: In voice channel -> 3 participants displayed + overflow badge
{
    const indicator = new SimulatedIndicator();
    const currentUser = { id: 'user_self', username: 'Me' };
    const channel = {
        id: 'voice_123',
        voice_states: [
            { user: currentUser, voice_state: { mute: false, deaf: false } },
            { user: { id: 'u1', username: 'Alice' }, voice_state: { mute: false, deaf: false } },
            { user: { id: 'u2', username: 'Bob' }, voice_state: { mute: true, deaf: false } },
            { user: { id: 'u3', username: 'Charlie' }, voice_state: { mute: false, deaf: true } },
            { user: { id: 'u4', username: 'Dave' }, voice_state: { mute: false, deaf: false } },
        ],
    };

    indicator.updateVoiceState({
        isConnected: true,
        isAuthenticated: true,
        channel,
        currentUser,
        maxParticipants: 3,
        showParticipants: true,
    });

    assert.strictEqual(indicator._participantWidgets.length, 3, 'Should render 3 participant widgets');
    assert.strictEqual(indicator._taskbarParticipantsBox.get_children().length, 3, 'Box should have 3 children');
    assert.strictEqual(indicator._participantWidgets[0].borderColor, '#23a55a', 'Alice is active green');
    assert.strictEqual(indicator._participantWidgets[1].borderColor, '#f23f43', 'Bob is muted red');
    assert.strictEqual(indicator._participantWidgets[2].borderColor, '#f0b232', 'Charlie is deafened yellow');
    assert.strictEqual(indicator._taskbarOverflowLabel.visible, true, 'Overflow badge should be visible');
    assert.strictEqual(indicator._taskbarOverflowLabel.text, '+1', 'Overflow badge should show +1 (Dave)');
    console.log('✓ Test 1: Active voice channel renders participant icons and overflow badge correctly');

    // Test 2: User leaves voice chat (channel = null)
    const oldWidgets = [...indicator._participantWidgets];
    indicator.updateVoiceState({
        isConnected: true,
        isAuthenticated: true,
        channel: null,
        currentUser,
    });

    assert.strictEqual(indicator._participantWidgets.length, 0, 'Participant widgets array must be empty');
    assert.strictEqual(indicator._taskbarParticipantsBox.get_children().length, 0, 'Box children must be empty');
    assert.strictEqual(indicator._taskbarOverflowLabel.visible, false, 'Overflow badge must be hidden');
    assert.strictEqual(indicator._taskbarOverflowLabel.text, '', 'Overflow badge text must be empty');
    assert.strictEqual(indicator._taskbarAvatar.borderColor, 'transparent', 'Avatar active border must reset to transparent');
    for (const w of oldWidgets) {
        assert.strictEqual(w.destroyed, true, 'Previous participant widgets must be destroyed to prevent leaks');
    }
    console.log('✓ Test 2: Leaving voice chat completely removes and destroys all taskbar participant icons');

    // Test 3: Disconnecting from Discord entirely
    indicator.updateVoiceState({
        isConnected: true,
        isAuthenticated: true,
        channel,
        currentUser,
    });
    assert.strictEqual(indicator._participantWidgets.length, 3);

    indicator.updateVoiceState({
        isConnected: false,
        isAuthenticated: false,
        channel: null,
        currentUser: null,
    });
    assert.strictEqual(indicator._participantWidgets.length, 0, 'Must be cleared on socket disconnect');
    assert.strictEqual(indicator._taskbarParticipantsBox.get_children().length, 0);
    console.log('✓ Test 3: Socket disconnect cleans up taskbar participant icons');
}

console.log('All participant lifecycle tests passed successfully!');
