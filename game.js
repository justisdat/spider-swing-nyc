(() => {
      'use strict';

      // ============================================================
      // CANVAS & VIEWPORT
      // ============================================================
      const canvas = document.getElementById('game-canvas');
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');

      const WORLD_H = 720;
      const GROUND_Y = 668;
      let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      let viewW = 1280;
      let baseScale = 1;
      let camZoom = 1;

      const settings = { physics: 'standard', windFx: true, screenShake: true, liteMode: false, prismTrail: false, showFps: false };
      const PHYSICS_PRESETS = {
        standard: { gravity: 880, pump: 225, maxVx: 980, reel: 275 },
        turbo:    { gravity: 1020, pump: 310, maxVx: 1180, reel: 345 },
        floaty:   { gravity: 710, pump: 195, maxVx: 900, reel: 245 }
      };

      function makeRadialSprite(size, stops) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const gctx = c.getContext('2d');
        const half = size * 0.5;
        const g = gctx.createRadialGradient(half, half, size * 0.04, half, half, half);
        for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
        gctx.fillStyle = g;
        gctx.fillRect(0, 0, size, size);
        return c;
      }

      const GLOW_SPRITES = {
        gold:     makeRadialSprite(64, [[0, 'rgba(253, 224, 71, 0.65)'], [1, 'rgba(253, 224, 71, 0)']]),
        green:    makeRadialSprite(64, [[0, 'rgba(34, 197, 94, 0.42)'], [1, 'rgba(34, 197, 94, 0)']]),
        orange:   makeRadialSprite(64, [[0, 'rgba(254, 240, 138, 0.90)'], [0.45, 'rgba(249, 115, 22, 0.65)'], [1, 'rgba(239, 68, 68, 0)']]),
        cyan:     makeRadialSprite(64, [[0, 'rgba(224, 242, 254, 0.95)'], [0.45, 'rgba(56, 189, 248, 0.48)'], [1, 'rgba(56, 189, 248, 0)']]),
        fogLight: makeRadialSprite(128, [[0, 'rgba(228, 238, 248, 0.85)'], [0.55, 'rgba(228, 238, 248, 0.35)'], [1, 'rgba(228, 238, 248, 0)']]),
        fogDark:  makeRadialSprite(128, [[0, 'rgba(98, 118, 146, 0.85)'], [0.55, 'rgba(98, 118, 146, 0.35)'], [1, 'rgba(98, 118, 146, 0)']])
      };

      function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, settings.liteMode ? 1.0 : 1.5);
        const w = window.innerWidth, h = window.innerHeight;
        canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        baseScale = h / WORLD_H;
        viewW = w / (baseScale * camZoom);
      }
      window.addEventListener('resize', resizeCanvas);
      resizeCanvas();

      // ============================================================
      // MATH & COLOR HELPERS
      // ============================================================
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const lerp = (a, b, t) => a + (b - a) * t;
      function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
      function rgbStr(rgb, alpha = 1) { return alpha >= 0.999 ? `rgb(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0})` : `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${alpha.toFixed(3)})`; }
      function lerpRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
      function pseudoRand(seed) { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }

      // ============================================================
      // AUDIO ENGINE WITH 16 DISTINCT SUIT WEB-SHOOTING SOUNDS!
      // ============================================================
      const AudioFX = {
        ctx: null, enabled: true, rainGain: null, windGain: null, windFilter: null, ambientReady: false,

        init() {
          if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
          if (this.ctx && !this.ambientReady) this.setupAmbientChannels();
        },

        setupAmbientChannels() {
          try {
            const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), data = buf.getChannelData(0);
            let lastOut = 0;
            for (let i = 0; i < len; i++) { lastOut = (lastOut + 0.045 * (Math.random() * 2 - 1)) / 1.045; data[i] = lastOut * 2.4; }
            const rSrc = this.ctx.createBufferSource(); rSrc.buffer = buf; rSrc.loop = true;
            const rFilt = this.ctx.createBiquadFilter(); rFilt.type = 'bandpass'; rFilt.frequency.value = 1150; rFilt.Q.value = 0.7;
            const rGain = this.ctx.createGain(); rGain.gain.value = 0;
            rSrc.connect(rFilt); rFilt.connect(rGain); rGain.connect(this.ctx.destination); rSrc.start();
            this.rainGain = rGain;

            const wSrc = this.ctx.createBufferSource(); wSrc.buffer = buf; wSrc.loop = true;
            const wFilt = this.ctx.createBiquadFilter(); wFilt.type = 'bandpass'; wFilt.frequency.value = 380; wFilt.Q.value = 1.4;
            const wGain = this.ctx.createGain(); wGain.gain.value = 0;
            wSrc.connect(wFilt); wFilt.connect(wGain); wGain.connect(this.ctx.destination); wSrc.start();
            this.windFilter = wFilt; this.windGain = wGain;
            this.ambientReady = true;
          } catch (_) {}
        },

        updateAmbient(rainIntensity, windFactor) {
          if (!this.ambientReady || !this.ctx) return;
          const now = this.ctx.currentTime;
          this.rainGain.gain.setTargetAtTime(this.enabled && state !== 'paused' && state !== 'photo' ? rainIntensity * 0.075 : 0, now, 0.2);
          const wTarget = (this.enabled && settings.windFx && state === 'playing') ? windFactor * 0.085 : 0;
          this.windGain.gain.setTargetAtTime(wTarget, now, 0.12);
          this.windFilter.frequency.setTargetAtTime(320 + windFactor * 940, now, 0.12);
        },

        playThwip(soundType = 'classic') {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime;
          const makeNoise = (dur, fStart, fEnd, q, vol) => {
            const bufLen = Math.floor(this.ctx.sampleRate * dur), buffer = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate), data = buffer.getChannelData(0);
            for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 1.7);
            const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass';
            filter.frequency.setValueAtTime(fStart, t); filter.frequency.exponentialRampToValueAtTime(fEnd, t + dur * 0.9); filter.Q.value = q;
            const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            noise.connect(filter); filter.connect(g); g.connect(this.ctx.destination); noise.start(t);
          };
          const makeTone = (type, f1, f2, dur, vol, delay = 0) => {
            const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(f1, t + delay); osc.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + delay + dur);
            g.gain.setValueAtTime(vol, t + delay); g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
            osc.connect(g); g.connect(this.ctx.destination); osc.start(t + delay); osc.stop(t + delay + dur + 0.01);
          };

          switch (soundType) {
            case 'snap':      makeNoise(0.085, 2900, 900, 3.2, 0.24); makeTone('triangle', 1050, 320, 0.055, 0.13); break;
            case 'chime':     makeNoise(0.10, 3100, 1200, 2.4, 0.16); makeTone('sine', 1320, 880, 0.12, 0.10); makeTone('sine', 1760, 1180, 0.10, 0.06, 0.02); break;
            case 'electric':  makeNoise(0.11, 3800, 1100, 1.8, 0.24); makeTone('sawtooth', 1480, 310, 0.075, 0.12); makeTone('square', 680, 1650, 0.06, 0.08, 0.025); break;
            case 'laser':     makeNoise(0.07, 4200, 1600, 4.0, 0.15); makeTone('sawtooth', 1950, 420, 0.11, 0.14); makeTone('sine', 960, 260, 0.09, 0.09); break;
            case 'noir':      makeNoise(0.14, 1500, 340, 1.9, 0.26); makeTone('triangle', 420, 110, 0.11, 0.14); break;
            case 'mech':      makeNoise(0.09, 3200, 1100, 3.4, 0.20); makeTone('square', 1650, 1100, 0.04, 0.09); makeTone('triangle', 980, 1520, 0.08, 0.11, 0.02); break;
            case 'symbiote':  makeNoise(0.15, 1100, 260, 2.8, 0.26); makeTone('sawtooth', 260, 72, 0.15, 0.16); makeTone('sine', 420, 140, 0.12, 0.10, 0.02); break;
            case 'synth':     makeNoise(0.08, 3400, 1400, 3.0, 0.15); makeTone('sawtooth', 880, 440, 0.10, 0.11); makeTone('triangle', 1320, 660, 0.12, 0.10, 0.015); break;
            case 'guitar':    makeNoise(0.09, 2600, 800, 2.0, 0.16); makeTone('sawtooth', 330, 315, 0.14, 0.11); makeTone('sawtooth', 495, 480, 0.14, 0.09, 0.01); makeTone('square', 660, 620, 0.11, 0.06, 0.02); break;
            case 'royal':     makeNoise(0.09, 3000, 1200, 2.8, 0.18); makeTone('sine', 1568, 1568, 0.14, 0.09); makeTone('triangle', 2093, 1396, 0.12, 0.07, 0.02); break;
            case 'cosmic':    makeNoise(0.13, 2400, 600, 1.6, 0.16); makeTone('sine', 520, 1280, 0.16, 0.11); makeTone('triangle', 260, 520, 0.17, 0.10); break;
            case 'quantum':   makeNoise(0.09, 3600, 1800, 3.6, 0.16); makeTone('sine', 1400, 2100, 0.09, 0.09); makeTone('sine', 700, 1050, 0.11, 0.08, 0.02); break;
            case 'flame':     makeNoise(0.16, 1800, 420, 1.3, 0.28); makeTone('sawtooth', 360, 120, 0.13, 0.11); makeTone('triangle', 740, 280, 0.09, 0.07, 0.03); break;
            case 'antivenom': makeNoise(0.14, 1400, 480, 2.4, 0.22); makeTone('sawtooth', 340, 110, 0.13, 0.13); makeTone('sine', 1020, 540, 0.11, 0.08, 0.02); break;
            case 'superior':  makeNoise(0.09, 3500, 950, 3.8, 0.21); makeTone('square', 1800, 620, 0.055, 0.09); makeTone('sawtooth', 620, 1420, 0.08, 0.10, 0.025); break;
            default:          makeNoise(0.10, 2550, 740, 2.6, 0.23); makeTone('triangle', 920, 240, 0.068, 0.12);
          }
        },

        playThunder() {
          if (!this.enabled || !this.ctx) return;
          const t = this.ctx.currentTime, len = Math.floor(this.ctx.sampleRate * 1.35), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), data = buf.getChannelData(0);
          let v = 0; for (let i = 0; i < len; i++) { v = (v + 0.06 * (Math.random() * 2 - 1)) / 1.06; data[i] = v * Math.pow(1 - i / len, 1.4) * 3.0; }
          const src = this.ctx.createBufferSource(); src.buffer = buf;
          const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(160, t); lp.frequency.exponentialRampToValueAtTime(55, t + 1.25);
          const g = this.ctx.createGain(); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
          src.connect(lp); lp.connect(g); g.connect(this.ctx.destination); src.start(t);
        },

        playRelease(perfect) {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = perfect ? 'sine' : 'triangle'; osc.frequency.setValueAtTime(perfect ? 440 : 280, t); osc.frequency.exponentialRampToValueAtTime(perfect ? 920 : 190, t + (perfect ? 0.16 : 0.09));
          gain.gain.setValueAtTime(perfect ? 0.12 : 0.05, t); gain.gain.exponentialRampToValueAtTime(0.001, t + (perfect ? 0.18 : 0.1));
          osc.connect(gain); gain.connect(this.ctx.destination); osc.start(t); osc.stop(t + 0.19);
        },

        playToken(combo) {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, base = 540 + Math.min(combo, 8) * 55;
          [base, base * 1.25].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t + idx * 0.042);
            gain.gain.setValueAtTime(0.10, t + idx * 0.042); gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.042 + 0.15);
            osc.connect(gain); gain.connect(this.ctx.destination); osc.start(t + idx * 0.042); osc.stop(t + idx * 0.042 + 0.16);
          });
        },

        playFanfare() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime;
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
            osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, t + idx * 0.065);
            g.gain.setValueAtTime(0.13, t + idx * 0.065); g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.065 + 0.25);
            osc.connect(g); g.connect(this.ctx.destination); osc.start(t + idx * 0.065); osc.stop(t + idx * 0.065 + 0.27);
          });
        },

        playHeroTeamup() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime;
          [392, 523.25, 659.25, 783.99].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, t + idx * 0.05);
            g.gain.setValueAtTime(0.12, t + idx * 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.05 + 0.28);
            osc.connect(g); g.connect(this.ctx.destination); osc.start(t + idx * 0.05); osc.stop(t + idx * 0.05 + 0.30);
          });
        },

        playShutter() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), g = this.ctx.createGain();
          osc.type = 'square'; osc.frequency.setValueAtTime(1200, t); osc.frequency.exponentialRampToValueAtTime(300, t + 0.045);
          g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          osc.connect(g); g.connect(this.ctx.destination); osc.start(t); osc.stop(t + 0.055);
        },

        playBoost() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = 'sawtooth'; osc.frequency.setValueAtTime(190, t); osc.frequency.exponentialRampToValueAtTime(660, t + 0.22);
          const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(1500, t);
          gain.gain.setValueAtTime(0.12, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
          osc.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); osc.start(t); osc.stop(t + 0.26);
        },

        playSmash() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = 'square'; osc.frequency.setValueAtTime(170, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.18);
          gain.gain.setValueAtTime(0.16, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.connect(gain); gain.connect(this.ctx.destination); osc.start(t); osc.stop(t + 0.21);
        },

        playHit() {
          if (!this.enabled) return;
          this.init(); if (!this.ctx) return;
          const t = this.ctx.currentTime, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
          osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, t); osc.frequency.linearRampToValueAtTime(60, t + 0.22);
          gain.gain.setValueAtTime(0.17, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
          osc.connect(gain); gain.connect(this.ctx.destination); osc.start(t); osc.stop(t + 0.25);
        }
      };

      // ============================================================
      // 16 SPIDER-VERSE SUITS (2 STARTERS + 14 CHALLENGING UNLOCKS!)
      // ============================================================
      const SUITS = {
        classic: {
          name: 'Peter Parker (Cổ điển)', tier: 'Khởi đầu', swatch: 'from-red-500 to-blue-700',
          primary: '#dc2626', secondary: '#1d4ed8', accent: '#111827', eyeFill: '#ffffff', eyeRim: '#0f172a',
          webColor: '#f8fafc', trailColor: 'rgba(239, 68, 68, 0.58)',
          soundType: 'classic', soundLabel: 'Tơ lụa cổ điển',
          skillTitle: 'Cân Bằng Hoàn Hảo', skillDesc: '+10% lực vọt khi nhả tơ đúng nhịp.',
          special: 'none', unlockKey: null, perks: { launchBoost: 1.10 }
        },
        scarlet: {
          name: 'Scarlet Spider', tier: 'Khởi đầu', swatch: 'from-rose-600 via-red-600 to-sky-500',
          primary: '#e11d48', secondary: '#0284c7', accent: '#0f172a', eyeFill: '#ffffff', eyeRim: '#09090b',
          webColor: '#f8fafc', trailColor: 'rgba(2, 132, 199, 0.58)',
          soundType: 'snap', soundLabel: 'Tơ giòn sắc gọn',
          skillTitle: 'Áo Hoodie Lướt Gió', skillDesc: 'Thu ngắn dây tơ nhanh hơn +22%.',
          special: 'hoodie_vest', unlockKey: null, perks: { reelMult: 1.22 }
        },
        gwen: {
          name: 'Spider-Gwen', tier: 'Đồng', swatch: 'from-white via-pink-400 to-teal-400',
          primary: '#f8fafc', secondary: '#18181b', accent: '#ec4899', boots: '#2dd4bf', hood: '#ffffff', hoodInner: '#ec4899',
          eyeFill: '#ffffff', eyeRim: '#ec4899', webColor: '#fdf2f8', trailColor: 'rgba(236, 72, 153, 0.54)',
          soundType: 'chime', soundLabel: 'Tơ pha lê thanh thoát',
          skillTitle: 'Vũ Điệu Không Trung', skillDesc: 'Trọng lực nhẹ hơn 10%, bay bổng cực êm.',
          special: 'hood', unlockKey: 'dist_300', perks: { gravMult: 0.90 }
        },
        miles: {
          name: 'Miles Morales', tier: 'Đồng', swatch: 'from-zinc-900 via-rose-600 to-yellow-400',
          primary: '#18181b', secondary: '#09090b', accent: '#e11d48', eyeFill: '#ffffff', eyeRim: '#e11d48',
          webColor: '#fef08a', trailColor: 'rgba(250, 204, 21, 0.65)',
          soundType: 'electric', soundLabel: 'Tơ tĩnh điện Venom',
          skillTitle: 'Tay Phóng Sét Venom', skillDesc: '2 tay rực tia sét; Bứt tốc phóng sóng điện nổ Drone gần!',
          special: 'venom_hands', unlockKey: 'perfect_15', perks: { venomPulse: true }
        },
        punk: {
          name: 'Spider-Punk', tier: 'Đồng', swatch: 'from-red-600 via-blue-600 to-yellow-400',
          primary: '#dc2626', secondary: '#2563eb', accent: '#facc15', eyeFill: '#ffffff', eyeRim: '#09090b',
          webColor: '#fde047', trailColor: 'rgba(244, 63, 94, 0.65)',
          soundType: 'guitar', soundLabel: 'Tơ Guitar Rock điện',
          skillTitle: 'Nhịp Điệu Rock & Roll', skillDesc: 'Mào gai Mohawk; Nhả tơ hoàn hảo cộng +2 Combo!',
          special: 'mohawk', unlockKey: 'four_seasons', perks: { comboGain: 2 }
        },
        noir: {
          name: 'Spider-Man Noir', tier: 'Bạc', swatch: 'from-zinc-800 via-zinc-900 to-slate-400',
          primary: '#18181b', secondary: '#27272a', accent: '#cbd5e1', eyeFill: '#e2e8f0', eyeRim: '#09090b',
          webColor: '#cbd5e1', trailColor: 'rgba(148, 163, 184, 0.55)',
          soundType: 'noir', soundLabel: 'Tơ trầm cổ điển 1933',
          skillTitle: 'Thám Tử Bóng Đêm', skillDesc: 'Áo choàng đen + Mũ phớt; Điểm Lướt mái & Né sát x1.5!',
          special: 'noir_coat', unlockKey: 'skim_12', perks: { stuntMult: 1.5 }
        },
        cyber: {
          name: 'Cyber Neon NYC', tier: 'Bạc', swatch: 'from-cyan-400 via-fuchsia-500 to-slate-900',
          primary: '#0f172a', secondary: '#06b6d4', accent: '#ec4899', eyeFill: '#22d3ee', eyeRim: '#ec4899',
          webColor: '#22d3ee', trailColor: 'rgba(34, 211, 238, 0.68)',
          soundType: 'synth', soundLabel: 'Tơ Synthwave điện tử',
          skillTitle: 'Từ Trường Hút Xu', skillDesc: 'Luôn tự động hút Xu Nhện trong tầm gần!',
          special: 'cyber_neon', unlockKey: 'token_80', perks: { passiveMagnet: 165 }
        },
        iron: {
          name: 'Iron Spider', tier: 'Bạc', swatch: 'from-red-600 via-red-700 to-amber-400',
          primary: '#b91c1c', secondary: '#1e3a8a', accent: '#f59e0b', eyeFill: '#bae6fd', eyeRim: '#f59e0b',
          webColor: '#fef3c7', trailColor: 'rgba(245, 158, 11, 0.64)',
          soundType: 'mech', soundLabel: 'Tơ cơ khí Stark',
          skillTitle: '4 Chân Nhện Cơ Khí', skillDesc: 'Tăng lên 4 Tim bảo vệ & 4 chân cơ khí vàng kim.',
          special: 'iron_legs', unlockKey: 'hero_6', perks: { extraHeart: 1 }
        },
        future: {
          name: 'Future Foundation', tier: 'Bạc', swatch: 'from-white via-slate-100 to-zinc-900',
          primary: '#f8fafc', secondary: '#0f172a', accent: '#09090b', eyeFill: '#0f172a', eyeRim: '#38bdf8',
          webColor: '#ffffff', trailColor: 'rgba(224, 242, 254, 0.72)',
          soundType: 'quantum', soundLabel: 'Tơ lượng tử sắc nét',
          skillTitle: 'Cánh Lướt Khí Động', skillDesc: 'Cánh lưới trắng giảm tốc rơi -22%, lướt cực xa!',
          special: 'wing_glider', unlockKey: 'total_dist_2500', perks: { fallDamp: 0.78 }
        },
        miguel: {
          name: 'Spider-Man 2099', tier: 'Vàng', swatch: 'from-blue-900 via-indigo-800 to-red-500',
          primary: '#1e3a8a', secondary: '#0f172a', accent: '#ef4444', eyeFill: '#ef4444', eyeRim: '#7f1d1d',
          webColor: '#fb7185', trailColor: 'rgba(239, 68, 68, 0.68)',
          soundType: 'laser', soundLabel: 'Tơ Laser tương lai',
          skillTitle: 'Tơ Laser Siêu Tốc', skillDesc: 'Tốc độ tối đa +15% & mở khóa Vệt Cầu Vồng!',
          special: 'laser_web', unlockKey: 'speed_225', perks: { maxVxMult: 1.15 }
        },
        symbiote: {
          name: 'Symbiote (Venom)', tier: 'Vàng', swatch: 'from-black via-slate-900 to-white',
          primary: '#09090b', secondary: '#111827', accent: '#f8fafc', eyeFill: '#ffffff', eyeRim: '#000000',
          webColor: '#1e293b', trailColor: 'rgba(15, 23, 42, 0.80)',
          soundType: 'symbiote', soundLabel: 'Tơ xúc tu hắc ám',
          skillTitle: 'Xúc Tu Hắc Ám', skillDesc: 'Hồi thanh Bứt tốc nhanh +30% & xúc tu sống động!',
          special: 'tendrils', unlockKey: 'drone_18', perks: { dashRegenMult: 1.30 }
        },
        antivenom: {
          name: 'Anti-Venom', tier: 'Vàng', swatch: 'from-slate-100 via-white to-black',
          primary: '#f1f5f9', secondary: '#09090b', accent: '#09090b', eyeFill: '#09090b', eyeRim: '#f8fafc',
          webColor: '#e2e8f0', trailColor: 'rgba(241, 245, 249, 0.75)',
          soundType: 'antivenom', soundLabel: 'Tơ kháng thể trầm vang',
          skillTitle: 'Kháng Thể Hồi Phục', skillDesc: 'Xúc tu trắng-đen; Tự hồi +1 Tim sau mỗi 350m đu tơ!',
          special: 'anti_tendrils', unlockKey: 'combo_8', perks: { healEveryMeters: 350 }
        },
        gold: {
          name: 'Giáp Hoàng Kim 24K', tier: 'Vàng', swatch: 'from-yellow-300 via-amber-400 to-yellow-700',
          primary: '#f59e0b', secondary: '#111827', accent: '#fef08a', eyeFill: '#ffffff', eyeRim: '#b45309',
          webColor: '#fef08a', trailColor: 'rgba(250, 204, 21, 0.74)',
          soundType: 'royal', soundLabel: 'Tơ chuông vàng ngân',
          skillTitle: 'Hào Quang Hoàng Kim', skillDesc: 'Nhân +25% toàn bộ điểm số & 4 chân vàng kim!',
          special: 'gold_sparkle', unlockKey: 'boss_3', perks: { scoreMult: 1.25 }
        },
        spirit: {
          name: 'Spirit Spider (Đầu Lửa)', tier: 'Huyền Thoại', swatch: 'from-sky-400 via-blue-600 to-slate-100',
          primary: '#f8fafc', secondary: '#1e3a8a', accent: '#38bdf8', eyeFill: '#38bdf8', eyeRim: '#0f172a',
          webColor: '#7dd3fc', trailColor: 'rgba(56, 189, 248, 0.76)',
          soundType: 'flame', soundLabel: 'Tơ lửa xanh bùng cháy',
          skillTitle: 'Ngọn Lửa Linh Hồn', skillDesc: 'Đầu rực lửa xanh; Phá Drone/Bom hồi ngay +45% Bứt tốc!',
          special: 'ghost_flame', unlockKey: 'missions_6', perks: { smashDashBonus: 45 }
        },
        superior: {
          name: 'Superior Spider-Man', tier: 'Huyền Thoại', swatch: 'from-red-700 via-zinc-900 to-slate-300',
          primary: '#991b1b', secondary: '#09090b', accent: '#e2e8f0', eyeFill: '#111827', eyeRim: '#dc2626',
          webColor: '#f8fafc', trailColor: 'rgba(220, 38, 38, 0.65)',
          soundType: 'superior', soundLabel: 'Tơ khóa cơ khí Doc Ock',
          skillTitle: 'Trí Tuệ Siêu Việt', skillDesc: '4 tay bạch tuộc đỏ-bạc; Bắn tơ xa +18% & điểm +20%!',
          special: 'superior_arms', unlockKey: 'total_dist_6000', perks: { reachMult: 1.18, scoreMult: 1.20 }
        },
        cosmic: {
          name: 'Cosmic Spider-Man', tier: 'Huyền Thoại', swatch: 'from-indigo-950 via-sky-500 to-white',
          primary: '#1e1b4b', secondary: '#0284c7', accent: '#ffffff', eyeFill: '#ffffff', eyeRim: '#38bdf8',
          webColor: '#bae6fd', trailColor: 'rgba(56, 189, 248, 0.78)',
          soundType: 'cosmic', soundLabel: 'Tơ cộng hưởng vũ trụ',
          skillTitle: 'Sức Mạnh Vũ Trụ', skillDesc: 'Tự tạo Khiên Vũ Trụ mỗi 15 giây & tốc độ +18%!',
          special: 'cosmic_stars', unlockKey: 'legend_25k', perks: { maxVxMult: 1.18, autoShieldSec: 15 }
        }
      };
      const SUIT_KEYS = Object.keys(SUITS);

      // ============================================================
      // 14 PROGRESSIVE ACHIEVEMENTS (4 TIERS: ĐỒNG -> HUYỀN THOẠI)
      // ============================================================
      const ACH_STORAGE_KEY = 'spiderman_nyc_achievements_v3';
      const TIER_STYLES = {
        'Đồng':        'bg-amber-700/35 text-amber-200 border-amber-500/40',
        'Bạc':         'bg-slate-400/25 text-slate-200 border-slate-300/40',
        'Vàng':        'bg-yellow-500/25 text-yellow-200 border-yellow-400/50',
        'Huyền Thoại': 'bg-fuchsia-500/25 text-fuchsia-200 border-fuchsia-400/55'
      };

      const ACH_DEFS = [
        { id: 'dist_300',        tier: 'Đồng',        icon: '🗽', title: 'Lính Mới Manhattan',  desc: 'Đu tơ đạt 300m trong 1 lượt',          stat: 'maxDist',       target: 300,   unlockSuit: 'gwen',      rewardPts: 350 },
        { id: 'perfect_15',      tier: 'Đồng',        icon: '⚡', title: 'Nghệ Sĩ Nhào Lộn',    desc: 'Tổng 15 lần Nhả tơ hoàn hảo',          stat: 'perfects',      target: 15,    unlockSuit: 'miles',     rewardPts: 450 },
        { id: 'four_seasons',    tier: 'Đồng',        icon: '🎸', title: 'Du Hành Bốn Mùa',     desc: 'Trải nghiệm đủ 4 kiểu thời tiết',      stat: 'weathersSeen',  target: 4,     unlockSuit: 'punk',      rewardPts: 500 },

        { id: 'skim_12',         tier: 'Bạc',         icon: '🕵️', title: 'Lướt Gió Đỉnh Mái',   desc: 'Tổng 12 lần Lướt sát mái nhà',         stat: 'skims',         target: 12,    unlockSuit: 'noir',      rewardPts: 600 },
        { id: 'token_80',        tier: 'Bạc',         icon: '🪙', title: 'Thợ Săn Xu Nhện',     desc: 'Thu thập tổng cộng 80 Xu Nhện',        stat: 'tokensTotal',   target: 80,    unlockSuit: 'cyber',     rewardPts: 650 },
        { id: 'hero_6',          tier: 'Bạc',         icon: '🦸', title: 'Đồng Minh Avengers',  desc: 'Gặp & kết nối 6 Siêu Anh Hùng',        stat: 'heroesMet',     target: 6,     unlockSuit: 'iron',      rewardPts: 700 },
        { id: 'total_dist_2500', tier: 'Bạc',         icon: '🧬', title: 'Khách Quen Đa Vũ Trụ',desc: 'Tích lũy tổng quãng đường 2.500m',     stat: 'totalDist',     target: 2500,  unlockSuit: 'future',    rewardPts: 750 },

        { id: 'speed_225',       tier: 'Vàng',        icon: '🚀', title: 'Bóng Ma Siêu Thanh',  desc: 'Đạt tốc độ 225 km/h',                  stat: 'maxSpeed',      target: 225,   unlockSuit: 'miguel',    rewardPts: 850 },
        { id: 'drone_18',        tier: 'Vàng',        icon: '🖤', title: 'Cơn Ác Mộng Drone',   desc: 'Phá hủy tổng 18 Drone / Bom',          stat: 'smashes',       target: 18,    unlockSuit: 'symbiote',  rewardPts: 900 },
        { id: 'combo_8',         tier: 'Vàng',        icon: '🔥', title: 'Chuỗi Combo Bất Bại', desc: 'Đạt Combo x8 trong một lượt',          stat: 'maxCombo',      target: 8,     unlockSuit: 'antivenom', rewardPts: 950 },
        { id: 'boss_3',          tier: 'Vàng',        icon: '🎃', title: 'Thủ Lĩnh Săn Boss',   desc: 'Đánh bại Green Goblin / Electro 3 lần',stat: 'bossesBeat',    target: 3,     unlockSuit: 'gold',      rewardPts: 1100 },

        { id: 'missions_6',      tier: 'Huyền Thoại', icon: '💀', title: 'Linh Hồn Rực Cháy',   desc: 'Hoàn thành tổng 6 Nhiệm vụ mini',      stat: 'missionsDone',  target: 6,     unlockSuit: 'spirit',    rewardPts: 1200 },
        { id: 'total_dist_6000', tier: 'Huyền Thoại', icon: '🦾', title: 'Trí Tuệ Tối Thượng',  desc: 'Tích lũy tổng quãng đường 6.000m',     stat: 'totalDist',     target: 6000,  unlockSuit: 'superior',  rewardPts: 1400 },
        { id: 'legend_25k',      tier: 'Huyền Thoại', icon: '🌌', title: 'Huyền Thoại New York',desc: 'Đạt 25.000 điểm trong 1 lượt chơi',    stat: 'bestScore',     target: 25000, unlockSuit: 'cosmic',    rewardPts: 2000 }
      ];

      let achData = {
        unlocked: {},
        stats: { maxDist: 0, totalDist: 0, perfects: 0, maxSpeed: 0, maxCombo: 1, heroesMet: 0, tokensTotal: 0, smashes: 0, skims: 0, weathersSeen: 1, bossesBeat: 0, missionsDone: 0, bestScore: 0 },
        seenWeathers: { sunny: true }
      };
      try {
        const saved = JSON.parse(localStorage.getItem(ACH_STORAGE_KEY) || 'null');
        if (saved && saved.unlocked && saved.stats) {
          achData = { ...achData, ...saved, stats: { ...achData.stats, ...saved.stats }, seenWeathers: { sunny: true, ...(saved.seenWeathers || {}) } };
        }
      } catch (_) {}

      function getPlayerRank() {
        const n = Object.keys(achData.unlocked).length;
        if (n >= 13) return '👑 Huyền Thoại Đa Vũ Trụ';
        if (n >= 10) return '⚡ Siêu Anh Hùng NYC';
        if (n >= 6)  return '🛡️ Vệ Binh Manhattan';
        if (n >= 3)  return '🕸️ Anh Hùng Hàng Xóm';
        return '🌱 Tân Binh Queens';
      }

      let lastSaveTime = 0;
      function saveAchData(force = false) {
        const now = performance.now();
        if (!force && now - lastSaveTime < 2500) return;
        lastSaveTime = now;
        try { localStorage.setItem(ACH_STORAGE_KEY, JSON.stringify(achData)); } catch (_) {}
      }
      function isSuitUnlocked(suitKey) { const s = SUITS[suitKey]; return s && (!s.unlockKey || !!achData.unlocked[s.unlockKey]); }

      function recordStat(statKey, val, isMax = false) {
        if (isMax) achData.stats[statKey] = Math.max(achData.stats[statKey] || 0, val);
        else achData.stats[statKey] = (achData.stats[statKey] || 0) + val;
        checkAchievements();
        saveAchData(false);
      }

      function recordWeatherSeen(wKey) {
        if (!achData.seenWeathers[wKey]) {
          achData.seenWeathers[wKey] = true;
          achData.stats.weathersSeen = Object.keys(achData.seenWeathers).length;
          checkAchievements();
          saveAchData(true);
        }
      }

      function checkAchievements() {
        let changed = false;
        for (let i = 0; i < ACH_DEFS.length; i++) {
          const a = ACH_DEFS[i];
          if (achData.unlocked[a.id]) continue;
          if ((achData.stats[a.stat] || 0) >= a.target) {
            achData.unlocked[a.id] = true;
            changed = true;
            bonusScore += a.rewardPts;
            AudioFX.playFanfare();
            const suitName = SUITS[a.unlockSuit].name;
            showToast('🏆', `[${a.tier}] MỞ KHÓA GIÁP: ${suitName}!`, true);
            spawnFirework(camX + viewW * 0.55, 160);
            spawnFirework(camX + viewW * 0.35, 190);
          }
        }
        if (changed) { saveAchData(true); syncRewardsUI(); }
      }

      function syncRewardsUI() {
        const achCount = Object.keys(achData.unlocked).length;
        const unlockedSuits = SUIT_KEYS.filter((k) => isSuitUnlocked(k)).length;
        document.getElementById('hud-ach-count').textContent = `${achCount}/${ACH_DEFS.length}`;
        document.getElementById('hud-suit-count').textContent = `${unlockedSuits}/${SUIT_KEYS.length}`;

        const cur = SUITS[currentSuit];
        document.getElementById('settings-rank').textContent = getPlayerRank();
        document.getElementById('settings-suit-name').textContent = cur.name;
        document.getElementById('settings-suit-skill').textContent = `${cur.skillTitle}: ${cur.skillDesc}`;

        const prismUnlocked = !!achData.unlocked.speed_225;
        const chkPrism = document.getElementById('chk-prism');
        const prismTag = document.getElementById('prism-lock-tag');
        chkPrism.disabled = !prismUnlocked;
        if (prismUnlocked) { prismTag.textContent = '(Đã mở!)'; prismTag.className = 'text-[10px] text-emerald-400 font-bold'; }
      }

      function renderWardrobeModal() {
        const grid = document.getElementById('wardrobe-grid');
        let html = '';
        for (let i = 0; i < SUIT_KEYS.length; i++) {
          const key = SUIT_KEYS[i], s = SUITS[key];
          const unlocked = isSuitUnlocked(key), equipped = currentSuit === key;
          const reqAch = s.unlockKey ? ACH_DEFS.find((a) => a.id === s.unlockKey) : null;
          const curStat = reqAch ? Math.min(reqAch.target, Math.floor(achData.stats[reqAch.stat] || 0)) : 0;
          const tierCls = TIER_STYLES[s.tier] || 'bg-white/10 text-slate-200 border-white/15';

          html += `
            <button data-wardrobe-suit="${key}" class="wardrobe-card text-left rounded-2xl p-3 border transition cursor-pointer ${
              equipped ? 'bg-rose-600/24 border-rose-400 shadow-lg' :
              unlocked ? 'bg-white/6 hover:bg-white/12 border-white/15' :
              'bg-slate-900/55 border-white/8 opacity-85'
            }">
              <div class="flex items-start gap-2.5">
                <div class="w-10 h-10 rounded-xl shrink-0 bg-gradient-to-br ${s.swatch} border-2 ${equipped ? 'border-white' : 'border-white/40'} flex items-center justify-center shadow">
                  ${unlocked ? (equipped ? '<span class="text-white text-sm font-black drop-shadow">✓</span>' : '') : '<span class="text-sm">🔒</span>'}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-1">
                    <span class="font-extrabold text-white truncate">${s.name}</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${tierCls}">${s.tier}</span>
                  </div>
                  <div class="text-[11px] font-bold text-amber-300 mt-0.5">⚡ ${s.skillTitle}</div>
                  <div class="text-[11px] text-slate-300 leading-snug">${s.skillDesc}</div>
                  <div class="mt-1.5 flex items-center justify-between text-[10px] gap-2">
                    <span class="text-sky-300 font-semibold truncate">🔊 ${s.soundLabel}</span>
                    <span class="font-bold shrink-0 ${equipped ? 'text-rose-300' : unlocked ? 'text-emerald-300' : 'text-amber-200'}">
                      ${equipped ? 'Đang mặc' : unlocked ? 'Chọn mặc' : `🏆 ${curStat}/${reqAch.target}`}
                    </span>
                  </div>
                  ${!unlocked && reqAch ? `<div class="mt-1 text-[10px] text-slate-400 truncate">Mở khóa: ${reqAch.desc}</div>` : ''}
                </div>
              </div>
            </button>
          `;
        }
        grid.innerHTML = html;

        grid.querySelectorAll('.wardrobe-card').forEach((card) => {
          card.addEventListener('click', () => {
            const k = card.dataset.wardrobeSuit;
            if (!isSuitUnlocked(k)) {
              const req = ACH_DEFS.find((a) => a.id === SUITS[k].unlockKey);
              showToast('🔒', `[${req.tier}] ${req.title}: ${req.desc} để mở ${SUITS[k].name}!`);
              return;
            }
            equipSuit(k);
            renderWardrobeModal();
          });
        });
      }

      function renderAchievementsModal() {
        document.getElementById('ach-rank-line').textContent = `Danh hiệu hiện tại: ${getPlayerRank()}`;
        document.getElementById('ach-lifetime-bar').innerHTML = `
          <div><div class="text-slate-400">Tổng đường</div><div class="font-black text-white">${Math.floor(achData.stats.totalDist).toLocaleString('vi-VN')} m</div></div>
          <div><div class="text-slate-400">Tổng Xu</div><div class="font-black text-amber-300">${achData.stats.tokensTotal}</div></div>
          <div><div class="text-slate-400">Hạ Boss</div><div class="font-black text-emerald-300">${achData.stats.bossesBeat}</div></div>
          <div><div class="text-slate-400">Gặp Hero</div><div class="font-black text-sky-300">${achData.stats.heroesMet}</div></div>
        `;

        const list = document.getElementById('ach-list');
        let html = '';
        for (let i = 0; i < ACH_DEFS.length; i++) {
          const a = ACH_DEFS[i], done = !!achData.unlocked[a.id];
          const cur = Math.min(a.target, Math.floor(achData.stats[a.stat] || 0));
          const pct = Math.round((cur / a.target) * 100);
          const rewardSuit = SUITS[a.unlockSuit];
          const tierCls = TIER_STYLES[a.tier];
          html += `
            <div class="rounded-2xl p-3 border ${done ? 'bg-amber-400/12 border-amber-400/40' : 'bg-white/5 border-white/10'} flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${done ? 'bg-amber-400/25' : 'bg-white/10 opacity-75'}">${a.icon}</div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="text-[9px] px-1.5 py-0.5 rounded border font-bold shrink-0 ${tierCls}">${a.tier}</span>
                    <span class="font-extrabold ${done ? 'text-amber-300' : 'text-white'} truncate">${a.title}</span>
                  </div>
                  <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${done ? 'bg-emerald-500/25 text-emerald-300' : 'bg-white/10 text-slate-300'}">${done ? '✓ Đã mở' : `${cur}/${a.target}`}</span>
                </div>
                <div class="text-[11px] text-slate-300 mt-0.5">${a.desc}</div>
                <div class="mt-1.5 flex items-center justify-between gap-2">
                  <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div class="h-full rounded-full ${done ? 'bg-amber-400' : 'bg-rose-500'}" style="width:${pct}%"></div>
                  </div>
                  <span class="text-[10px] font-bold text-rose-300 shrink-0">🕷️ Mở: ${rewardSuit.name}</span>
                </div>
              </div>
            </div>
          `;
        }
        list.innerHTML = html;
      }

      // ============================================================
      // 5 DYNAMIC NYC DISTRICTS
      // ============================================================
      const DISTRICTS = [
        { name: 'MIDTOWN TIMES SQUARE', pool: ['times_media', 'sapphire_glass', 'artdeco_gold', 'times_media', 'soho_brick'] },
        { name: 'SOHO & GREENWICH',     pool: ['soho_brick', 'soho_brick', 'artdeco_gold', 'times_media', 'emerald_tower'] },
        { name: 'FINANCIAL DISTRICT',   pool: ['sapphire_glass', 'emerald_tower', 'sapphire_glass', 'artdeco_gold', 'emerald_tower'] },
        { name: 'CENTRAL PARK WEST',    pool: ['emerald_tower', 'artdeco_gold', 'soho_brick', 'sapphire_glass', 'emerald_tower'] },
        { name: 'BROOKLYN WATERFRONT',  pool: ['soho_brick', 'sapphire_glass', 'times_media', 'soho_brick', 'artdeco_gold'] }
      ];
      let currentDistrictIdx = 0;

      // ============================================================
      // WEATHER (30s AUTO) & COLLAPSIBLE TIME OF DAY
      // ============================================================
      const WEATHER_DURATION = 30;
      const WEATHER_ORDER = ['sunny', 'rain', 'snow', 'fog'];
      const WEATHER_META = {
        sunny: { icon: '☀️', label: 'Nắng',  toast: '☀️ Trời Nắng rực rỡ — Hồi Bứt tốc nhanh +15%!', desc: '☀️ Trời nắng ấm: Năng lượng Bứt tốc hồi nhanh +15%, tầm nhìn rõ nét.' },
        rain:  { icon: '🌧️', label: 'Mưa',   toast: '🌧️ Mưa bão Manhattan — Đường ướt soi bóng đèn & gió đẩy mạnh!', desc: '🌧️ Mưa rào & Sấm chớp: Nước bắn mái nhà, đường ướt phản chiếu & gió tăng đà.' },
        snow:  { icon: '❄️', label: 'Tuyết', toast: '❄️ Tuyết rơi NYC — Phủ trắng mặt đường, mái nhà & cầu Brooklyn!', desc: '❄️ Tuyết rơi dày: Đường phố, xe taxi, tàu điện & mái nhà phủ trắng tuyết; lướt êm.' },
        fog:   { icon: '🌫️', label: 'Sương', toast: '🌫️ Sương mù dày — Giác quan Nhện dò nguy hiểm xa hơn!', desc: '🌫️ Sương mù NYC: Đèn neon tỏa quầng sáng & Giác quan Nhện cảnh báo từ xa.' }
      };

      const TIME_META = {
        dawn:   { val: 0.25, icon: '🌅', label: 'Bình minh' },
        day:    { val: 0.48, icon: '☀️', label: 'Sáng' },
        sunset: { val: 0.76, icon: '🌇', label: 'Hoàng hôn' },
        night:  { val: 0.96, icon: '🌙', label: 'Đêm' }
      };

      const TIME_KEYFRAMES = [
        { t: 0.00, skyTop: hexToRgb('#04091a'), skyMid: hexToRgb('#101d3b'), skyBot: hexToRgb('#1e3157'), farCity: hexToRgb('#0d1730'), midCity: hexToRgb('#142240'), nearTint: hexToRgb('#0e172a'), rim: hexToRgb('#38bdf8'), windowGlow: 0.95, starAlpha: 1.0,  daylight: 0.12 },
        { t: 0.25, skyTop: hexToRgb('#1e40af'), skyMid: hexToRgb('#f97316'), skyBot: hexToRgb('#fef08a'), farCity: hexToRgb('#4f5d85'), midCity: hexToRgb('#3b486b'), nearTint: hexToRgb('#2e3854'), rim: hexToRgb('#fde047'), windowGlow: 0.46, starAlpha: 0.14, daylight: 0.68 },
        { t: 0.48, skyTop: hexToRgb('#0284c7'), skyMid: hexToRgb('#38bdf8'), skyBot: hexToRgb('#e0f2fe'), farCity: hexToRgb('#6c94ba'), midCity: hexToRgb('#4f7499'), nearTint: hexToRgb('#3d5470'), rim: hexToRgb('#ffffff'), windowGlow: 0.12, starAlpha: 0.0,  daylight: 1.00 },
        { t: 0.64, skyTop: hexToRgb('#0369a1'), skyMid: hexToRgb('#60a5fa'), skyBot: hexToRgb('#fef3c7'), farCity: hexToRgb('#6482a6'), midCity: hexToRgb('#486382'), nearTint: hexToRgb('#344863'), rim: hexToRgb('#fef08a'), windowGlow: 0.18, starAlpha: 0.0,  daylight: 0.92 },
        { t: 0.76, skyTop: hexToRgb('#2e1065'), skyMid: hexToRgb('#be185d'), skyBot: hexToRgb('#fb923c'), farCity: hexToRgb('#4a224d'), midCity: hexToRgb('#361a3f'), nearTint: hexToRgb('#241630'), rim: hexToRgb('#fb923c'), windowGlow: 0.74, starAlpha: 0.25, daylight: 0.50 },
        { t: 0.88, skyTop: hexToRgb('#070e22'), skyMid: hexToRgb('#152447'), skyBot: hexToRgb('#2b3e66'), farCity: hexToRgb('#101c38'), midCity: hexToRgb('#162547'), nearTint: hexToRgb('#101b33'), rim: hexToRgb('#60a5fa'), windowGlow: 0.92, starAlpha: 0.90, daylight: 0.18 },
        { t: 1.00, skyTop: hexToRgb('#04091a'), skyMid: hexToRgb('#101d3b'), skyBot: hexToRgb('#1e3157'), farCity: hexToRgb('#0d1730'), midCity: hexToRgb('#142240'), nearTint: hexToRgb('#0e172a'), rim: hexToRgb('#38bdf8'), windowGlow: 0.95, starAlpha: 1.0,  daylight: 0.12 }
      ];

      const env = {
        autoWeather: true, autoTime: false,
        weatherIndex: 0, targetWeather: 'sunny', weatherTimer: WEATHER_DURATION,
        wSunny: 1, wRain: 0, wSnow: 0, wFog: 0, snowAccum: 0, wetness: 0,
        lightningFlash: 0, lightningCooldown: 4.5, lightningBolt: null,
        dayTime: TIME_META.day.val, targetDayTime: TIME_META.day.val, selectedTimeKey: 'day', dayCycleSeconds: 150
      };

      function getCurrentLighting() {
        const t = ((env.dayTime % 1) + 1) % 1;
        let k0 = TIME_KEYFRAMES[0], k1 = TIME_KEYFRAMES[1];
        for (let i = 0; i < TIME_KEYFRAMES.length - 1; i++) { if (t >= TIME_KEYFRAMES[i].t && t <= TIME_KEYFRAMES[i + 1].t) { k0 = TIME_KEYFRAMES[i]; k1 = TIME_KEYFRAMES[i + 1]; break; } }
        const f = (t - k0.t) / Math.max(0.0001, k1.t - k0.t);
        let skyTop = lerpRgb(k0.skyTop, k1.skyTop, f), skyMid = lerpRgb(k0.skyMid, k1.skyMid, f), skyBot = lerpRgb(k0.skyBot, k1.skyBot, f);
        let farCity = lerpRgb(k0.farCity, k1.farCity, f), midCity = lerpRgb(k0.midCity, k1.midCity, f), nearTint = lerpRgb(k0.nearTint, k1.nearTint, f);
        let rim = lerpRgb(k0.rim, k1.rim, f), windowGlow = lerp(k0.windowGlow, k1.windowGlow, f), starAlpha = lerp(k0.starAlpha, k1.starAlpha, f), daylight = lerp(k0.daylight, k1.daylight, f);

        if (env.wRain > 0.01) {
          skyTop = lerpRgb(skyTop, daylight > 0.45 ? [48, 66, 90] : [10, 17, 32], env.wRain * 0.62);
          skyMid = lerpRgb(skyMid, daylight > 0.45 ? [78, 98, 122] : [18, 30, 48], env.wRain * 0.58);
          skyBot = lerpRgb(skyBot, [106, 124, 148], env.wRain * 0.34 * daylight);
          starAlpha *= (1 - env.wRain * 0.85); windowGlow = Math.min(1, windowGlow + env.wRain * 0.34);
        }
        if (env.wSnow > 0.01) {
          skyTop = lerpRgb(skyTop, daylight > 0.45 ? [154, 188, 222] : [18, 30, 58], env.wSnow * 0.54);
          skyMid = lerpRgb(skyMid, daylight > 0.45 ? [204, 226, 246] : [34, 50, 82], env.wSnow * 0.56);
          skyBot = lerpRgb(skyBot, daylight > 0.45 ? [238, 246, 255] : [64, 84, 118], env.wSnow * 0.60);
          starAlpha *= (1 - env.wSnow * 0.6);
        }
        if (env.wFog > 0.01) {
          const fBase = daylight > 0.45 ? [190, 206, 220] : [42, 54, 76];
          skyTop = lerpRgb(skyTop, fBase, env.wFog * 0.44); skyMid = lerpRgb(skyMid, fBase, env.wFog * 0.68);
          skyBot = lerpRgb(skyBot, fBase, env.wFog * 0.84); farCity = lerpRgb(farCity, fBase, env.wFog * 0.60);
          starAlpha *= (1 - env.wFog * 0.9);
        }
        return { skyTop, skyMid, skyBot, farCity, midCity, nearTint, rim, windowGlow, starAlpha, daylight };
      }

      let toastTimeout = null;
      function showToast(icon, text, isGold = false) {
        const el = document.getElementById('weather-toast'), box = document.getElementById('weather-toast-box');
        document.getElementById('weather-toast-icon').textContent = icon;
        document.getElementById('weather-toast-text').textContent = text;
        box.style.borderColor = isGold ? 'rgba(250, 204, 21, 0.75)' : 'rgba(255, 255, 255, 0.2)';
        el.style.opacity = '1';
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => { el.style.opacity = '0'; }, isGold ? 4200 : 3400);
      }

      function setWeather(key, showNotice = true) {
        const idx = WEATHER_ORDER.indexOf(key); if (idx === -1) return;
        env.weatherIndex = idx; env.targetWeather = key; env.weatherTimer = WEATHER_DURATION;
        recordWeatherSeen(key);
        document.querySelectorAll('.weather-btn').forEach((b) => { b.classList.toggle('sub-active', b.dataset.weather === key); b.classList.toggle('text-slate-300', b.dataset.weather !== key); });
        document.getElementById('weather-effect-desc').textContent = WEATHER_META[key].desc;
        if (showNotice) showToast(WEATHER_META[key].icon, WEATHER_META[key].toast);
      }

      function setTimePreset(key) {
        if (!TIME_META[key]) return;
        env.autoTime = false; env.selectedTimeKey = key; env.targetDayTime = TIME_META[key].val;
        updateTimeMenuUI();
      }

      function updateTimeMenuUI() {
        const badgeAuto = document.getElementById('badge-time-auto');
        if (env.autoTime) {
          badgeAuto.textContent = 'Bật'; badgeAuto.className = 'text-[10px] px-1.5 py-0.5 rounded bg-rose-600 text-white font-bold';
          const t = env.dayTime;
          const curKey = (t >= 0.18 && t < 0.34) ? 'dawn' : (t >= 0.34 && t < 0.68) ? 'day' : (t >= 0.68 && t < 0.84) ? 'sunset' : 'night';
          document.getElementById('hud-time-icon').textContent = TIME_META[curKey].icon;
          document.getElementById('hud-time-name').textContent = TIME_META[curKey].label;
          document.querySelectorAll('.time-opt').forEach((b) => { b.classList.remove('active', 'text-white'); b.classList.add('text-slate-200'); });
        } else {
          badgeAuto.textContent = 'Tắt'; badgeAuto.className = 'text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400';
          const meta = TIME_META[env.selectedTimeKey];
          document.getElementById('hud-time-icon').textContent = meta.icon;
          document.getElementById('hud-time-name').textContent = meta.label;
          document.querySelectorAll('.time-opt').forEach((b) => { const m = b.dataset.time === env.selectedTimeKey; b.classList.toggle('active', m); b.classList.toggle('text-white', m); b.classList.toggle('text-slate-200', !m); });
        }
      }

      function updateEnvironment(dt) {
        if (env.autoWeather && state !== 'paused' && state !== 'photo') {
          env.weatherTimer -= dt;
          if (env.weatherTimer <= 0) setWeather(WEATHER_ORDER[(env.weatherIndex + 1) % WEATHER_ORDER.length], state === 'playing');
        }
        const rate = Math.min(1, dt * 1.15);
        env.wSunny += ((env.targetWeather === 'sunny' ? 1 : 0) - env.wSunny) * rate;
        env.wRain  += ((env.targetWeather === 'rain'  ? 1 : 0) - env.wRain)  * rate;
        env.wSnow  += ((env.targetWeather === 'snow'  ? 1 : 0) - env.wSnow)  * rate;
        env.wFog   += ((env.targetWeather === 'fog'   ? 1 : 0) - env.wFog)   * rate;

        if (env.wSnow > 0.25) env.snowAccum = Math.min(1, env.snowAccum + dt * 0.22 * env.wSnow);
        else env.snowAccum = Math.max(0, env.snowAccum - dt * (env.wRain > 0.3 ? 0.26 : 0.14));
        if (env.wRain > 0.25) env.wetness = Math.min(1, env.wetness + dt * 0.28 * env.wRain);
        else env.wetness = Math.max(0, env.wetness - dt * 0.12);

        if (env.lightningFlash > 0) { env.lightningFlash = Math.max(0, env.lightningFlash - dt * 4.0); if (env.lightningFlash <= 0.05) env.lightningBolt = null; }
        if (env.wRain > 0.55) {
          env.lightningCooldown -= dt;
          if (env.lightningCooldown <= 0) {
            env.lightningCooldown = 4.2 + Math.random() * 6.0; env.lightningFlash = 0.88;
            const bx = viewW * (0.2 + Math.random() * 0.65), pts = [{ x: bx, y: 0 }];
            let cx = bx, cy = 0;
            for (let i = 0; i < 7; i++) { cx += (Math.random() - 0.5) * 44; cy += 38 + Math.random() * 34; pts.push({ x: cx, y: cy }); }
            env.lightningBolt = pts; AudioFX.playThunder();
          }
        }
        if (env.autoTime) { env.dayTime = (env.dayTime + dt / env.dayCycleSeconds) % 1; updateTimeMenuUI(); }
        else {
          let diff = env.targetDayTime - env.dayTime;
          if (diff > 0.5) diff -= 1; if (diff < -0.5) diff += 1;
          env.dayTime = ((env.dayTime + diff * Math.min(1, dt * 3.8)) % 1 + 1) % 1;
        }
      }

      // ============================================================
      // MINI-MISSIONS
      // ============================================================
      const MISSION_POOL = [
        { type: 'perfect', label: 'Nhả tơ hoàn hảo', target: 4, reward: 550 },
        { type: 'tokens',  label: 'Thu thập Xu Nhện', target: 10, reward: 550 },
        { type: 'speed',   label: 'Đạt tốc độ 195 km/h', target: 195, reward: 650 },
        { type: 'skim',    label: 'Lướt sát mái nhà', target: 3, reward: 600 },
        { type: 'smash',   label: 'Phá Drone / Bom', target: 3, reward: 750 }
      ];
      let currentMission = null, missionSeq = 0;
      function nextMission() { currentMission = { ...MISSION_POOL[missionSeq % MISSION_POOL.length], progress: 0 }; missionSeq++; updateMissionUI(); }
      function progressMission(type, amount = 1, isMaxVal = false) {
        if (!currentMission || currentMission.type !== type || state !== 'playing') return;
        currentMission.progress = isMaxVal ? Math.max(currentMission.progress, amount) : currentMission.progress + amount;
        if (currentMission.progress >= currentMission.target) {
          const pts = Math.round(currentMission.reward * (SUITS[currentSuit].perks.scoreMult || 1));
          bonusScore += pts; player.dashEnergy = 100; player.magnetTimer = 6.5;
          if (player.hearts < player.maxHearts) player.hearts++;
          recordStat('missionsDone', 1);
          AudioFX.playFanfare();
          showToast('🎯', `Xong nhiệm vụ: ${currentMission.label}! +${pts} & Nam châm hút xu!`, true);
          spawnPopup(player.x, player.y - 54, `NHIỆM VỤ XONG! +${pts}`, '#4ade80', 21);
          nextMission();
        } else updateMissionUI();
      }
      function updateMissionUI() {
        const pill = document.getElementById('mission-pill');
        const distPill = document.getElementById('district-pill');
        if (!currentMission || state !== 'playing') {
          pill.classList.add('hidden'); pill.classList.remove('flex');
          distPill.classList.add('hidden');
          return;
        }
        pill.classList.remove('hidden'); pill.classList.add('flex');
        distPill.classList.remove('hidden');
        document.getElementById('mission-text').textContent = currentMission.label;
        document.getElementById('mission-prog').textContent = currentMission.type === 'speed' ? `${Math.floor(currentMission.progress)}/${currentMission.target}` : `${currentMission.progress}/${currentMission.target}`;
        distPill.textContent = `📍 ${DISTRICTS[currentDistrictIdx].name}`;
      }

      // ============================================================
      // GAME STATE & ENTITIES
      // ============================================================
      let currentSuit = 'classic';
      let gameMode = 'arcade';
      let state = 'start';

      const STORAGE_KEY = 'spiderman_swing_nyc_best_v7';
      let bestScore = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0;

      const keys = { left: false, right: false, up: false, down: false, space: false, focus: false };
      let activeWebPointerId = null, pointerWorldX = 0, pointerWorldY = 0, pointerActive = false;
      let reelHoldActive = false, focusHoldActive = false, impactSlowMo = 0;

      const player = {
        x: 160, y: 260, vx: 360, vy: -40, angle: 0, spinVel: 0, flipping: false,
        attached: false, anchor: null, ropeLen: 220, webAnim: 0,
        dashEnergy: 100, dashTimer: 0, invulnTimer: 0,
        shieldTimer: 0, magnetTimer: 0, cosmicShieldCooldown: 15, nextHealDist: 350,
        hearts: 3, maxHearts: 3, trail: [], spiderSense: 0, windFactor: 0,
        skimCooldown: 0, sonicRingCooldown: 0, breathTimer: 0
      };

      function equipSuit(suitKey) {
        if (!SUITS[suitKey] || !isSuitUnlocked(suitKey)) return;
        currentSuit = suitKey;
        const s = SUITS[suitKey];
        const newMaxH = 3 + (s.perks.extraHeart || 0);
        if (newMaxH > player.maxHearts) player.hearts += (newMaxH - player.maxHearts);
        player.maxHearts = newMaxH;
        player.hearts = Math.min(player.hearts, player.maxHearts);
        AudioFX.playThwip(s.soundType);
        syncRewardsUI();
        showToast('🕷️', `Đã mặc ${s.name} — ${s.skillTitle}!`);
        updateHud(Math.round(Math.hypot(player.vx, player.vy) * 0.24));
      }

      let camX = 0, camY = 0, shakeTimer = 0, shakeMag = 0;
      let score = 0, bonusScore = 0, startX = 160, maxDistance = 0, lastRecordedDist = 0, maxSpeedKmh = 0;
      let combo = 1, comboTimer = 0, swingCount = 0, elapsedTime = 0, hintFaded = false;

      let buildings = [], farSkyline = [], midSkyline = [], landmarks = [];
      let stars = [], clouds = [], birds = [], blimp = { x: 640, y: 72, speed: 16 };
      let plane = { x: -200, y: 42, speed: 54 };
      let rainDrops = [], rainSplashes = [], snowFlakes = [], fogBanks = [], steamPuffs = [], streetSteam = [];
      let helicopters = [], subwayTrain = { x: -400, speed: 350 }, taxis = [];
      let windRibbons = [], windStreaks = [], shockwaves = [], fireworks = [];
      let tokens = [], boostRings = [], powerups = [], drones = [];
      let boss = null; // Alternates between Green Goblin & Electro!
      let bossProjectiles = [];
      let heroCameos = [], roofPigeons = [], particles = [], popups = [];

      let nextBuildingX = -220, nextFarX = -300, nextMidX = -300, nextLandmarkX = 200;
      let landmarkSeq = 0, lastEntityX = 480, nextBossDist = 155, bossSeq = 0, nextHeroTimer = 7, fireworkCooldown = 3.2;

      const MODERN_BRANDS = [
        { text: 'STARK EXPO',   bg: '#0284c7', fg: '#ffffff', glow: '#38bdf8', sub: 'NEW YORK 2026' },
        { text: 'DAILY BUGLE',  bg: '#dc2626', fg: '#ffffff', glow: '#f87171', sub: 'BREAKING NEWS' },
        { text: 'OSCORP',       bg: '#16a34a', fg: '#ffffff', glow: '#4ade80', sub: 'FUTURE BIOTECH' },
        { text: 'TIMES SQUARE', bg: '#f59e0b', fg: '#0f172a', glow: '#fde047', sub: 'BROADWAY LIVE' },
        { text: 'NYC JAZZ',     bg: '#e11d48', fg: '#ffffff', glow: '#fb7185', sub: 'MIDTOWN CLUB' },
        { text: 'F.E.A.S.T.',   bg: '#0d9488', fg: '#ffffff', glow: '#2dd4bf', sub: 'MANHATTAN' }
      ];
      const BLADE_SIGNS = [
        { text: 'HOTEL', color: '#f43f5e' }, { text: 'CAFE', color: '#f59e0b' },
        { text: 'PIZZA', color: '#ef4444' }, { text: 'NYC',  color: '#38bdf8' }, { text: 'JAZZ', color: '#a855f7' }
      ];

      function initAtmosphere() {
        stars = Array.from({ length: 100 }, () => ({ rx: Math.random(), ry: Math.random() * 0.56, size: 0.7 + Math.random() * 1.8, twinkle: Math.random() * Math.PI * 2 }));
        clouds = Array.from({ length: 12 }, () => ({ x: Math.random() * 1900, y: 35 + Math.random() * 190, w: 120 + Math.random() * 190, h: 24 + Math.random() * 28, speed: 5 + Math.random() * 12, alpha: 0.16 + Math.random() * 0.18 }));
        birds = Array.from({ length: 7 }, () => ({ x: Math.random() * 1500, y: 75 + Math.random() * 185, speed: 48 + Math.random() * 34, wing: Math.random() * Math.PI * 2, size: 4 + Math.random() * 2.5 }));
        rainDrops = Array.from({ length: 145 }, () => { const d = 0.45 + Math.random() * 0.85; return { x: Math.random() * 1800, y: Math.random() * WORLD_H, len: 14 + d * 18, vy: 640 + d * 460, vx: -135 - d * 95, alpha: 0.22 + d * 0.38, width: 0.85 + d * 0.9 }; });
        snowFlakes = Array.from({ length: 125 }, () => { const d = 0.35 + Math.random() * 0.95; return { x: Math.random() * 1800, y: Math.random() * WORLD_H, r: 1.5 + d * 3.2, vy: 42 + d * 58, vx: -18 - d * 28, sway: Math.random() * Math.PI * 2, swayAmp: 14 + Math.random() * 24, alpha: 0.42 + d * 0.52 }; });
        fogBanks = Array.from({ length: 7 }, (_, i) => ({ x: Math.random() * 1800, y: 230 + i * 68, w: 440 + Math.random() * 440, h: 100 + Math.random() * 82, speed: 16 + Math.random() * 22, layer: i % 2 }));
        helicopters = [{ x: 450, y: 112, speed: 38, dir: 1, phase: 0 }];
        taxis = Array.from({ length: 11 }, (_, i) => ({
          x: i * 175 + Math.random() * 80, lane: i % 2,
          speed: (i % 2 === 0 ? 1 : -1) * (105 + Math.random() * 75),
          kind: i === 2 ? 'nypd' : (Math.random() < 0.65 ? 'taxi' : 'car'),
          color: ['#e11d48', '#2563eb', '#f8fafc', '#10b981'][i % 4]
        }));
      }

      // ============================================================
      // DISTRICT-DRIVEN HIGH-DETAIL NYC GENERATOR
      // ============================================================
      function generateParallaxSkyline() {
        while (nextFarX < camX * 0.16 + viewW + 1000) {
          const w = 65 + Math.random() * 105, h = 155 + Math.random() * 285;
          farSkyline.push({ x: nextFarX, w, h, spireH: Math.random() < 0.34 ? 34 + Math.random() * 68 : 0, stepped: Math.random() < 0.45 });
          nextFarX += w - 6 + Math.random() * 16;
        }
        while (farSkyline.length && farSkyline[0].x + farSkyline[0].w < camX * 0.16 - 420) farSkyline.shift();

        const landmarkTypes = ['liberty', 'avengers', 'bridge', 'empire', 'park_wheel', 'chrysler', 'wtc', 'flatiron'];
        while (nextLandmarkX < camX * 0.24 + viewW + 1100) {
          const type = landmarkTypes[landmarkSeq % landmarkTypes.length]; landmarkSeq++;
          const w = type === 'bridge' ? 520 : (type === 'park_wheel' ? 320 : (type === 'liberty' ? 220 : 130));
          landmarks.push({ type, x: nextLandmarkX, w });
          nextLandmarkX += w + 260 + Math.random() * 180;
        }
        while (landmarks.length && landmarks[0].x + landmarks[0].w < camX * 0.24 - 620) landmarks.shift();

        while (nextMidX < camX * 0.42 + viewW + 1000) {
          const w = 85 + Math.random() * 125, h = 165 + Math.random() * 305;
          const seed = Math.floor(Math.random() * 9999);
          const cols = Math.floor((w - 16) / 14), rows = Math.floor((h - 32) / 19);
          const warmWins = [], coolWins = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const p = pseudoRand(seed + r * 31 + c * 17);
            if (p > 0.85) coolWins.push(10 + c * 14, 24 + r * 19);
            else if (p > 0.63) warmWins.push(10 + c * 14, 24 + r * 19);
          }
          midSkyline.push({ x: nextMidX, w, h, seed, hasAntenna: Math.random() < 0.42, slanted: Math.random() < 0.32, hueShift: Math.floor(Math.random() * 4), warmWins, coolWins });
          nextMidX += w + 10 + Math.random() * 34;
        }
        while (midSkyline.length && midSkyline[0].x + midSkyline[0].w < camX * 0.42 - 420) midSkyline.shift();
      }

      function generateBuildingsAndEntities() {
        const pool = DISTRICTS[currentDistrictIdx].pool;
        while (nextBuildingX < camX + viewW + 1450) {
          const style = pool[Math.floor(Math.random() * pool.length)];
          const w = style === 'soho_brick' ? 148 + Math.random() * 64 : 158 + Math.random() * 102;
          const topY = style === 'soho_brick' ? 192 + Math.random() * 80 : 106 + Math.random() * 138;
          const seed = Math.floor(Math.random() * 100000);

          const hasSpire = style === 'emerald_tower' || style === 'artdeco_gold' || (style === 'sapphire_glass' && Math.random() < 0.42);
          const spireH = hasSpire ? 56 + Math.random() * 44 : 0;
          const hasCrane = !hasSpire && (style === 'sapphire_glass' || style === 'times_media') && Math.random() < 0.24;
          const hasHelipad = style === 'sapphire_glass' && !hasSpire && !hasCrane;
          const hasSkyGarden = style === 'emerald_tower';
          const hasWindTurbine = style === 'emerald_tower' && Math.random() < 0.65;
          const hasWaterTower = style === 'soho_brick';
          const hasFireEscape = style === 'soho_brick';
          const hasFlag = !hasSpire && !hasCrane && Math.random() < 0.35;
          const hasHVAC = !hasSkyGarden && Math.random() < 0.62;
          const hasAwning = style === 'soho_brick' || style === 'artdeco_gold';
          const hasSpotlight = style === 'times_media' || style === 'artdeco_gold';
          const hasSteamVent = Math.random() < 0.52;
          const bladeSign = (style === 'soho_brick' || style === 'times_media' || Math.random() < 0.30) ? BLADE_SIGNS[seed % BLADE_SIGNS.length] : null;
          const brand = (style === 'times_media' || style === 'artdeco_gold' || Math.random() < 0.38) ? MODERN_BRANDS[seed % MODERN_BRANDS.length] : null;
          const accentColor = style === 'emerald_tower' ? '#10b981' : style === 'sapphire_glass' ? '#38bdf8' : style === 'times_media' ? '#f43f5e' : style === 'artdeco_gold' ? '#f59e0b' : '#ea580c';
          const storefrontColor = ['#dc2626', '#0284c7', '#16a34a', '#d97706', '#7c3aed'][seed % 5];

          const padX = 16, stepX = (style === 'sapphire_glass' || style === 'emerald_tower') ? 16 : 20, stepY = (style === 'sapphire_glass' || style === 'emerald_tower') ? 19 : 23;
          const cols = Math.max(2, Math.floor((w - padX * 2) / stepX));
          const rows = Math.max(3, Math.floor((GROUND_Y - topY - 96) / stepY));
          const windows = [];
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const p = pseudoRand(seed + r * 43 + c * 17);
            windows.push({ rx: padX + c * stepX, ry: 48 + r * stepY, litChance: p, warm: p > 0.65, hasBlind: p > 0.78 });
          }

          if (Math.random() < 0.34) {
            const pCount = 2 + (seed % 3);
            for (let p = 0; p < pCount; p++) roofPigeons.push({ x: nextBuildingX + 26 + p * 16, y: topY - 6, vx: 0, vy: 0, flying: false, wing: p * 1.1 });
          }

          const anchors = [{ x: nextBuildingX + 20, y: topY + 6 }, { x: nextBuildingX + w - 20, y: topY + 6 }];
          if (hasSpire) anchors.push({ x: nextBuildingX + w * 0.5, y: Math.max(50, topY - spireH * 0.78) });
          if (hasCrane) anchors.push({ x: nextBuildingX + w * 0.5 + 54, y: Math.max(48, topY - 62) });

          buildings.push({
            x: nextBuildingX, w, topY, style, seed,
            hasSpire, spireH, hasCrane, hasHelipad, hasSkyGarden, hasWindTurbine, hasWaterTower,
            hasFireEscape, hasFlag, hasHVAC, hasAwning, hasSpotlight, hasSteamVent,
            ventOffset: 24 + (seed % Math.max(24, Math.floor(w - 50))),
            bladeSign, brand, accentColor, storefrontColor, windows,
            winW: (style === 'sapphire_glass' || style === 'emerald_tower') ? 11 : 10, winH: 13, anchors
          });

          if (nextBuildingX > lastEntityX + 265 && nextBuildingX > 520) {
            const centerX = nextBuildingX + w * 0.5, roll = Math.random();
            if (roll < 0.44) {
              const count = 3 + Math.floor(Math.random() * 3), arcBaseY = 250 + Math.random() * 190;
              for (let i = 0; i < count; i++) {
                const t = i / (count - 1) - 0.5;
                tokens.push({ x: centerX + t * 140, y: arcBaseY + t * t * 120, r: 14, collected: false, phase: i * 0.5 });
              }
            } else if (roll < 0.68) {
              // Single or thrilling Double Boost Ring climb!
              const ry = 235 + Math.random() * 195;
              boostRings.push({ x: centerX, y: ry, r: 36, triggered: false, phase: Math.random() * Math.PI * 2 });
              if (Math.random() < 0.35) {
                boostRings.push({ x: centerX + 165, y: Math.max(130, ry - 68), r: 34, triggered: false, phase: 1.5 });
              }
            } else if (roll < 0.80) {
              // Special Aerial Power-Up Orb (Overcharge / Magnet / Shield)!
              const pTypes = ['overcharge', 'magnet', 'shield'];
              const pType = pTypes[Math.floor(Math.random() * pTypes.length)];
              powerups.push({ x: centerX, y: 210 + Math.random() * 210, type: pType, r: 18, collected: false, phase: Math.random() * 6 });
            }

            const distM = Math.max(0, (nextBuildingX - startX) / 14);
            if (distM > 55 && Math.random() < Math.min(0.55, 0.16 + distM / 1200)) {
              drones.push({ x: nextBuildingX + w + 55, baseY: 220 + Math.random() * 250, y: 300, r: 20, amp: 34 + Math.random() * 48, freq: 1.5 + Math.random() * 1.4, phase: Math.random() * Math.PI * 2, alive: true, nearMissed: false });
            }
            lastEntityX = nextBuildingX;
          }
          nextBuildingX += w + 70 + Math.random() * 94;
        }

        const cullX = camX - 550;
        while (buildings.length && buildings[0].x + buildings[0].w < cullX) buildings.shift();
        while (tokens.length && tokens[0].x < cullX) tokens.shift();
        while (boostRings.length && boostRings[0].x < cullX) boostRings.shift();
        while (powerups.length && powerups[0].x < cullX) powerups.shift();
        while (drones.length && drones[0].x < cullX) drones.shift();
        while (roofPigeons.length && roofPigeons[0].x < cullX) roofPigeons.shift();
      }

      // ============================================================
      // FLYING MARVEL HERO CAMEOS
      // ============================================================
      const HERO_CAMEO_TYPES = [
        { type: 'ironman', name: 'Iron Man',       quote: 'Đua tốc độ không, nhóc?',  color: '#f59e0b', buffText: 'ĐỒNG ĐỘI IRON MAN! Đầy Bứt tốc +350' },
        { type: 'strange', name: 'Doctor Strange', quote: 'Qua cổng phép thuật nào!', color: '#fb923c', buffText: 'CỔNG KHÔNG GIAN STRANGE! +400' },
        { type: 'torch',   name: 'Human Torch',    quote: 'Flame On! Bắt kịp không?', color: '#f97316', buffText: 'LUỒNG LỬA HUMAN TORCH! +350' },
        { type: 'thor',    name: 'Thor',           quote: 'Sức mạnh sấm sét Midgard!', color: '#38bdf8', buffText: 'KHIÊN SÉT THOR (6s)! +400' },
        { type: 'ally',    name: 'Spider-Gwen',    quote: 'Đu cùng nhau nào bạn!',     color: '#ec4899', buffText: 'ĐỒNG ĐỘI SPIDER-VERSE! +300' }
      ];
      let heroSeq = 0;

      function spawnHeroCameo() {
        const def = HERO_CAMEO_TYPES[heroSeq % HERO_CAMEO_TYPES.length]; heroSeq++;
        const isPortal = def.type === 'strange', fromRight = def.type === 'ironman' || def.type === 'thor';
        heroCameos.push({
          ...def,
          x: isPortal ? camX + viewW + 180 : (fromRight ? camX + viewW + 160 : camX - 120),
          y: 175 + Math.random() * 195, baseY: 175 + Math.random() * 195,
          vx: isPortal ? 0 : (fromRight ? -240 : player.vx + 220),
          phase: 0, interacted: false, life: 10
        });
      }

      function updateHeroCameos(dt) {
        nextHeroTimer -= dt;
        if (nextHeroTimer <= 0 && heroCameos.length === 0) { spawnHeroCameo(); nextHeroTimer = 14 + Math.random() * 8; }
        const scoreMult = SUITS[currentSuit].perks.scoreMult || 1;
        for (let i = heroCameos.length - 1; i >= 0; i--) {
          const h = heroCameos[i]; h.phase += dt * 4; h.life -= dt;
          if (h.type === 'strange') {
            h.y = h.baseY + Math.sin(h.phase * 0.7) * 14;
            if (Math.random() < 0.45) {
              const ang = Math.random() * Math.PI * 2;
              particles.push({ x: h.x + 36 + Math.cos(ang) * 34, y: h.y + Math.sin(ang) * 44, vx: Math.cos(ang + 1.5) * 70, vy: Math.sin(ang + 1.5) * 70, life: 0.25, maxLife: 0.25, size: 2.5, color: '#fb923c' });
            }
          } else {
            h.x += h.vx * dt; h.y = h.baseY + Math.sin(h.phase) * 26;
            if (Math.random() < 0.65) {
              const col = h.type === 'torch' ? (Math.random() < 0.5 ? '#f97316' : '#fde047') : h.type === 'thor' ? '#38bdf8' : h.type === 'ironman' ? '#fbbf24' : '#ec4899';
              particles.push({ x: h.x - Math.sign(h.vx || 1) * 18, y: h.y + (Math.random() - 0.5) * 10, vx: -h.vx * 0.2, vy: (Math.random() - 0.5) * 35, life: 0.30, maxLife: 0.30, size: h.type === 'torch' ? 5 : 3.2, color: col });
            }
          }
          const targetX = h.type === 'strange' ? h.x + 36 : h.x;
          if (!h.interacted && state === 'playing' && Math.hypot(player.x - targetX, player.y - h.y) < 88) {
            h.interacted = true; AudioFX.playHeroTeamup(); recordStat('heroesMet', 1);
            spawnShockwave(targetX, h.y, h.color, 95); spawnParticles(targetX, h.y, 26, h.color, 80, 280, 2.5, 5.5);
            spawnPopup(player.x, player.y - 48, h.buffText, h.color, 19);
            if (h.type === 'ironman') { bonusScore += Math.round(350 * combo * scoreMult); player.dashEnergy = 100; player.vx = Math.max(player.vx + 180, 680); }
            else if (h.type === 'strange') { bonusScore += Math.round(400 * combo * scoreMult); player.vx = Math.max(player.vx + 280, 780); player.vy = -180; player.dashEnergy = Math.min(100, player.dashEnergy + 50); }
            else if (h.type === 'torch') { bonusScore += Math.round(350 * combo * scoreMult); player.vx = Math.max(player.vx + 220, 740); player.vy = Math.min(player.vy, -120); }
            else if (h.type === 'thor') { bonusScore += Math.round(400 * combo * scoreMult); player.shieldTimer = 6.5; }
            else { bonusScore += Math.round(300 * combo * scoreMult); combo = Math.min(10, combo + 2); comboTimer = 5.0; recordStat('maxCombo', combo, true); }
          }
          if (h.life <= 0 || h.x < camX - 420 || h.x > camX + viewW + 650) heroCameos.splice(i, 1);
        }
      }

      // ============================================================
      // BOSS ENCOUNTERS: GREEN GOBLIN & ELECTRO!
      // ============================================================
      function updateBossEncounters(dt) {
        if (gameMode !== 'arcade') return;
        const suit = SUITS[currentSuit];
        const scoreMult = suit.perks.scoreMult || 1;

        if (!boss && maxDistance > nextBossDist) {
          const isElectro = (bossSeq % 2 === 1);
          bossSeq++;
          boss = {
            kind: isElectro ? 'electro' : 'goblin',
            x: camX + viewW + 140, y: 175, baseY: 175,
            phase: 0, attackTimer: 1.4, life: 12
          };
          nextBossDist = maxDistance + 185 + Math.random() * 105;
          spawnPopup(player.x + 115, player.y - 60, isElectro ? '⚡ ELECTRO XUẤT HIỆN!' : '🎃 GREEN GOBLIN XUẤT HIỆN!', isElectro ? '#38bdf8' : '#4ade80', 19);
        }

        if (boss) {
          boss.phase += dt * 3.3; boss.life -= dt;
          boss.x += (player.x + 295 - boss.x) * Math.min(1, dt * 2.2);
          boss.y = boss.baseY + Math.sin(boss.phase) * 62;

          if (Math.random() < 0.6) {
            particles.push({
              x: boss.x + (boss.kind === 'electro' ? (Math.random() - 0.5) * 20 : 18),
              y: boss.y + (boss.kind === 'electro' ? (Math.random() - 0.5) * 24 : 12),
              vx: 65 + Math.random() * 50, vy: (Math.random() - 0.5) * 45,
              life: 0.25, maxLife: 0.25, size: 3.4,
              color: boss.kind === 'electro' ? '#38bdf8' : '#a855f7'
            });
          }

          boss.attackTimer -= dt;
          if (boss.attackTimer <= 0 && boss.life > 1.5) {
            boss.attackTimer = 2.4 + Math.random() * 1.3;
            if (boss.kind === 'goblin') {
              bossProjectiles.push({ kind: 'pumpkin', x: boss.x - 10, y: boss.y + 6, vx: player.vx * 0.45 - 95, vy: -95, r: 13 });
            } else {
              // Electro fires a fast horizontal blue lightning orb!
              bossProjectiles.push({ kind: 'bolt', x: boss.x - 16, y: boss.y, vx: player.vx * 0.25 - 230, vy: (player.y - boss.y) * 0.35, r: 14 });
            }
          }

          if (Math.hypot(player.x - boss.x, player.y - boss.y) < 48 && (player.dashTimer > 0 || player.shieldTimer > 0)) {
            const pts = Math.round((boss.kind === 'electro' ? 680 : 620) * combo * scoreMult);
            bonusScore += pts; combo = Math.min(10, combo + 2); comboTimer = 5.0; recordStat('maxCombo', combo, true);
            player.dashEnergy = Math.min(100, player.dashEnergy + (suit.perks.smashDashBonus || 30));
            AudioFX.playSmash(); addScreenShake(12, 0.3); if (settings.screenShake) impactSlowMo = 0.28;
            spawnParticles(boss.x, boss.y, 34, boss.kind === 'electro' ? '#38bdf8' : '#4ade80', 100, 340, 3, 6.5);
            spawnPopup(boss.x, boss.y - 30, boss.kind === 'electro' ? `HẠ GỤC ELECTRO! +${pts}` : `ĐÁNH BẠI GOBLIN! +${pts}`, boss.kind === 'electro' ? '#38bdf8' : '#4ade80', 23);
            progressMission('smash', 1); recordStat('bossesBeat', 1); recordStat('smashes', 1);
            boss = null;
          } else if (boss.life <= 0) {
            boss.x += 480 * dt; boss.y -= 260 * dt;
            if (boss.y < -80) boss = null;
          }
        }

        for (let i = bossProjectiles.length - 1; i >= 0; i--) {
          const b = bossProjectiles[i];
          if (b.kind === 'pumpkin') b.vy += 420 * dt;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (Math.hypot(player.x - b.x, player.y - b.y) < b.r + 22) {
            if (player.dashTimer > 0 || player.shieldTimer > 0) {
              const pts = Math.round(300 * combo * scoreMult); bonusScore += pts; AudioFX.playSmash();
              player.dashEnergy = Math.min(100, player.dashEnergy + (suit.perks.smashDashBonus || 18));
              spawnParticles(b.x, b.y, 18, b.kind === 'bolt' ? '#38bdf8' : '#fb923c', 80, 260, 2.5, 5);
              spawnPopup(b.x, b.y - 20, b.kind === 'bolt' ? `PHÁ CẦU SÉT! +${pts}` : `PHÁ BOM! +${pts}`, '#fb923c', 18);
              progressMission('smash', 1); recordStat('smashes', 1);
            } else if (player.invulnTimer <= 0) {
              player.hearts--; player.invulnTimer = 1.4; combo = 1; player.vy = -220;
              AudioFX.playHit(); addScreenShake(10, 0.28);
              spawnParticles(b.x, b.y, 20, b.kind === 'bolt' ? '#38bdf8' : '#f97316', 90, 280, 3, 6);
              spawnPopup(player.x, player.y - 35, b.kind === 'bolt' ? 'TRÚNG SÉT ELECTRO!' : 'TRÚNG BOM BÍ NGÔ!', '#fb923c', 20);
              if (player.hearts <= 0) { endGame(b.kind === 'bolt' ? 'Tia sét của Electro đã hạ gục Người Nhện!' : 'Bom Bí Ngô của Green Goblin đã hạ gục Người Nhện!'); return; }
            }
            bossProjectiles.splice(i, 1); continue;
          }
          if (b.y > GROUND_Y || b.x < camX - 220 || b.y < -80) {
            if (b.y > GROUND_Y) spawnParticles(b.x, GROUND_Y - 4, 10, b.kind === 'bolt' ? '#38bdf8' : '#f97316', 50, 180, 2, 4.5);
            bossProjectiles.splice(i, 1);
          }
        }
      }

      function spawnFirework(wx, wy) {
        const palette = ['#f43f5e', '#fde047', '#38bdf8', '#4ade80', '#f97316', '#e879f9'];
        const col = palette[Math.floor(Math.random() * palette.length)], count = settings.liteMode ? 12 : 22;
        for (let i = 0; i < count; i++) {
          const ang = (i / count) * Math.PI * 2 + Math.random() * 0.2, spd = 65 + Math.random() * 95;
          fireworks.push({ x: wx, y: wy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1.0, color: col, size: 2 + Math.random() * 1.8 });
        }
      }

      // ============================================================
      // ANCHOR TARGETING & FX
      // ============================================================
      function findBestAnchor(preferPointer) {
        const reach = SUITS[currentSuit].perks.reachMult || 1;
        const maxDist = 520 * reach;
        const maxAhead = 490 * reach;
        let best = null, bestScore = Infinity;
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i];
          if (b.x + b.w < player.x - 100 || b.x > player.x + maxAhead + 70) continue;
          for (let j = 0; j < b.anchors.length; j++) {
            const a = b.anchors[j], dx = a.x - player.x, dy = a.y - player.y, dist = Math.hypot(dx, dy);
            if (dx < -20 || dx > maxAhead || dist < 70 || dist > maxDist || a.y > player.y + 45) continue;
            let cost = Math.abs(dx - 190 * reach) + Math.abs(dy + 190) * 0.85;
            if (preferPointer && pointerActive) cost = cost * 0.45 + Math.hypot(a.x - pointerWorldX, a.y - pointerWorldY) * 0.75;
            if (cost < bestScore) { bestScore = cost; best = a; }
          }
        }
        return best || { x: player.x + 195 * reach, y: clamp(player.y - 195, 55, 210) };
      }

      function spawnParticles(x, y, count, color, speedMin, speedMax, sizeMin = 2, sizeMax = 5) {
        const maxPool = settings.liteMode ? 75 : 155;
        if (particles.length >= maxPool) return;
        const cap = Math.min(settings.liteMode ? Math.ceil(count * 0.5) : count, maxPool - particles.length);
        for (let i = 0; i < cap; i++) {
          const ang = Math.random() * Math.PI * 2, spd = speedMin + Math.random() * (speedMax - speedMin);
          particles.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.35 + Math.random() * 0.38, maxLife: 0.73, size: sizeMin + Math.random() * (sizeMax - sizeMin), color });
        }
      }
      function spawnShockwave(x, y, color = 'rgba(255,255,255,0.75)', maxR = 78) { if (settings.windFx) shockwaves.push({ x, y, r: 12, maxR, alpha: 0.9, color }); }
      function spawnPopup(x, y, text, color = '#ffffff', size = 20) { popups.push({ x, y, text, color, size, life: 1.0, vy: -65 }); }
      function addScreenShake(magnitude, duration) { if (settings.screenShake) { shakeMag = Math.max(shakeMag, magnitude); shakeTimer = Math.max(shakeTimer, duration); } }

      // ============================================================
      // CORE ACTIONS
      // ============================================================
      function attachWeb(preferPointer = false) {
        if (state !== 'playing' || player.attached) return;
        const target = findBestAnchor(preferPointer);
        player.attached = true; player.anchor = { x: target.x, y: target.y };
        const dist = Math.hypot(player.x - target.x, player.y - target.y);
        player.ropeLen = clamp(dist * 0.96, 95, 410 * (SUITS[currentSuit].perks.reachMult || 1));
        player.webAnim = 1.0; player.flipping = false; player.spinVel = 0;
        swingCount++;
        if (player.vy > 180) player.vx += 45;

        const suit = SUITS[currentSuit];
        AudioFX.playThwip(suit.soundType);
        spawnParticles(target.x, target.y, 10, env.wRain > 0.4 ? '#bae6fd' : suit.webColor, 40, 155, 2, 4);
        if (env.snowAccum > 0.3) spawnParticles(target.x, target.y, 8, '#ffffff', 30, 110, 2.5, 4.5);
        if (swingCount === 1 || Math.random() < 0.28) {
          const word = suit.soundType === 'laser' ? 'ZAP!' : suit.soundType === 'electric' ? 'BZZT!' : suit.soundType === 'guitar' ? 'ROCK!' : suit.soundType === 'flame' ? 'BURN!' : 'THWIP!';
          spawnPopup(player.x + 24, player.y - 34, word, suit.webColor, 17);
        }
        if (!hintFaded && swingCount >= 3) { hintFaded = true; const h = document.getElementById('controls-hint'); if (h) h.style.opacity = '0.4'; }
      }

      function releaseWeb() {
        if (!player.attached) return;
        player.attached = false; player.anchor = null;

        const suit = SUITS[currentSuit];
        const isPerfect = player.vx > 270 && player.vy < -75;
        if (isPerfect) {
          const preset = PHYSICS_PRESETS[settings.physics];
          const maxV = preset.maxVx * (suit.perks.maxVxMult || 1);
          player.vx = Math.min((player.vx * 1.14 + 38) * (suit.perks.launchBoost || 1.0), maxV);
          player.vy = Math.max(player.vy * 1.12 - 35, -650);
          player.flipping = true; player.spinVel = 12.2;
          player.dashEnergy = Math.min(100, player.dashEnergy + 18);

          combo = Math.min(10, combo + (suit.perks.comboGain || 1));
          comboTimer = 4.4;
          recordStat('maxCombo', combo, true);
          const pts = Math.round(150 * combo * (suit.perks.scoreMult || 1));
          bonusScore += pts;
          AudioFX.playRelease(true);
          spawnShockwave(player.x, player.y, 'rgba(253, 224, 71, 0.72)', 64);
          spawnParticles(player.x, player.y, 14, '#fde047', 60, 210, 2.5, 5);
          const phrases = ['NHẢ TƠ HOÀN HẢO!', 'SIÊU ĐỈNH!', 'BAY VÚT!', 'TUYỆT VỜI!'];
          spawnPopup(player.x, player.y - 44, `${phrases[combo % phrases.length]} +${pts}`, '#fde047', 19);
          progressMission('perfect', 1); recordStat('perfects', 1);
        } else {
          if (player.vx > 180 && player.vy < 40) { player.vx += 24; player.vy -= 22; }
          AudioFX.playRelease(false);
        }
      }

      function triggerDash() {
        if (state !== 'playing' || player.dashEnergy < 50 || player.dashTimer > 0) return;
        const suit = SUITS[currentSuit], preset = PHYSICS_PRESETS[settings.physics], maxV = preset.maxVx * (suit.perks.maxVxMult || 1);
        player.dashEnergy = Math.max(0, player.dashEnergy - 50);
        player.dashTimer = 0.44;
        if (player.attached) { player.attached = false; player.anchor = null; }
        player.vx = Math.max(player.vx + 380, maxV * 0.86);
        player.vy = Math.min(player.vy * 0.22, -90);
        player.flipping = false;

        AudioFX.playBoost(); addScreenShake(7, 0.22);
        spawnShockwave(player.x, player.y, suit.perks.venomPulse ? 'rgba(250, 204, 21, 0.95)' : 'rgba(56, 189, 248, 0.9)', suit.perks.venomPulse ? 150 : 95);
        spawnParticles(player.x, player.y, 24, suit.accent, 90, 320, 3, 6);
        spawnPopup(player.x + 20, player.y - 40, suit.perks.venomPulse ? 'SÓNG SÉT VENOM!' : 'SIÊU BỨT TỐC!', suit.perks.venomPulse ? '#fde047' : '#38bdf8', 22);

        if (suit.perks.venomPulse && gameMode === 'arcade') {
          for (let i = 0; i < drones.length; i++) {
            const d = drones[i];
            if (d.alive && Math.hypot(player.x - d.x, player.y - d.y) < 190) {
              d.alive = false; const pts = 400 * combo; bonusScore += pts; AudioFX.playSmash();
              spawnParticles(d.x, d.y, 24, '#fde047', 90, 300, 3, 6);
              spawnPopup(d.x, d.y - 24, `SÉT VENOM! +${pts}`, '#fde047', 20);
              progressMission('smash', 1); recordStat('smashes', 1);
            }
          }
          for (let i = bossProjectiles.length - 1; i >= 0; i--) {
            const b = bossProjectiles[i];
            if (Math.hypot(player.x - b.x, player.y - b.y) < 190) {
              bossProjectiles.splice(i, 1); bonusScore += 300 * combo;
              spawnParticles(b.x, b.y, 18, '#fde047', 80, 240, 2.5, 5);
              progressMission('smash', 1); recordStat('smashes', 1);
            }
          }
        }
      }

      function togglePause() {
        if (state === 'playing') {
          state = 'paused';
          document.getElementById('overlay-pause').classList.remove('hidden'); document.getElementById('overlay-pause').classList.add('flex');
          document.getElementById('icon-pause').classList.add('hidden'); document.getElementById('icon-play').classList.remove('hidden');
          AudioFX.updateAmbient(0, 0);
        } else if (state === 'paused') {
          state = 'playing';
          document.getElementById('overlay-pause').classList.add('hidden'); document.getElementById('overlay-pause').classList.remove('flex');
          document.getElementById('icon-pause').classList.remove('hidden'); document.getElementById('icon-play').classList.add('hidden');
        }
      }

      function togglePhotoMode() {
        if (state === 'playing') {
          state = 'photo'; AudioFX.playShutter(); AudioFX.updateAmbient(0, 0);
          document.getElementById('hud-top').classList.add('hud-hidden-photo'); document.getElementById('hud-bottom').classList.add('hud-hidden-photo');
          const bar = document.getElementById('photo-bar'); bar.classList.remove('hidden'); bar.classList.add('flex'); closePopovers();
        } else if (state === 'photo') {
          state = 'playing';
          document.getElementById('hud-top').classList.remove('hud-hidden-photo'); document.getElementById('hud-bottom').classList.remove('hud-hidden-photo');
          const bar = document.getElementById('photo-bar'); bar.classList.add('hidden'); bar.classList.remove('flex');
        }
      }

      function savePhotoPNG() {
        AudioFX.playShutter();
        const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height;
        const octx = out.getContext('2d'); octx.drawImage(canvas, 0, 0);
        octx.strokeStyle = 'rgba(255,255,255,0.88)'; octx.lineWidth = Math.max(6, out.width * 0.008);
        octx.strokeRect(octx.lineWidth * 0.5, octx.lineWidth * 0.5, out.width - octx.lineWidth, out.height - octx.lineWidth);
        octx.font = `900 italic ${Math.round(out.height * 0.036)}px system-ui, sans-serif`;
        octx.fillStyle = '#ffffff'; octx.strokeStyle = 'rgba(9,13,24,0.9)'; octx.lineWidth = 6;
        const tag = `SPIDER-SWING NYC • ${SUITS[currentSuit].name.toUpperCase()}`;
        octx.strokeText(tag, 26, out.height - 26); octx.fillText(tag, 26, out.height - 26);
        const a = document.createElement('a'); a.download = `spiderman-nyc-${Date.now()}.png`; a.href = out.toDataURL('image/png'); a.click();
        showToast('📸', 'Đã lưu ảnh Spider-Man NYC!');
      }

      // ============================================================
      // RESET & GAME OVER
      // ============================================================
      function resetGame(autoStart = true) {
        const s = SUITS[currentSuit];
        player.x = 160; player.y = 260; player.vx = 385; player.vy = -50;
        player.angle = 0; player.spinVel = 0; player.flipping = false;
        player.attached = false; player.anchor = null; player.ropeLen = 220;
        player.dashEnergy = 100; player.dashTimer = 0; player.invulnTimer = 0;
        player.shieldTimer = s.perks.autoShieldSec ? 5.0 : 0;
        player.cosmicShieldCooldown = s.perks.autoShieldSec || 15;
        player.nextHealDist = s.perks.healEveryMeters || 350;
        player.magnetTimer = 0;
        player.maxHearts = 3 + (s.perks.extraHeart || 0);
        player.hearts = player.maxHearts;
        player.trail = []; player.spiderSense = 0; player.windFactor = 0;
        player.skimCooldown = 0; player.sonicRingCooldown = 0; impactSlowMo = 0;

        startX = player.x; camZoom = 1; resizeCanvas();
        camX = player.x - viewW * 0.28; camY = 0;
        score = 0; bonusScore = 0; maxDistance = 0; lastRecordedDist = 0; maxSpeedKmh = 0;
        combo = 1; comboTimer = 0; swingCount = 0; nextBossDist = 155; bossSeq = 0; nextHeroTimer = 6;
        currentDistrictIdx = 0;

        buildings = []; farSkyline = []; midSkyline = []; landmarks = [];
        tokens = []; boostRings = []; powerups = []; drones = []; boss = null; bossProjectiles = [];
        heroCameos = []; roofPigeons = []; particles = []; popups = []; steamPuffs = []; streetSteam = [];
        rainSplashes = []; windRibbons = []; windStreaks = []; shockwaves = []; fireworks = [];
        nextBuildingX = -220; nextFarX = -300; nextMidX = -300; nextLandmarkX = 200;
        landmarkSeq = 0; lastEntityX = 480; missionSeq = 0;

        generateParallaxSkyline();
        generateBuildingsAndEntities();

        ['overlay-gameover', 'overlay-pause', 'photo-bar'].forEach((id) => {
          const el = document.getElementById(id); el.classList.add('hidden'); el.classList.remove('flex');
        });
        document.getElementById('hud-top').classList.remove('hud-hidden-photo');
        document.getElementById('hud-bottom').classList.remove('hud-hidden-photo');
        document.getElementById('icon-pause').classList.remove('hidden');
        document.getElementById('icon-play').classList.add('hidden');

        if (autoStart) {
          state = 'playing';
          document.getElementById('overlay-start').classList.add('hidden');
          nextMission();
          attachWeb(false);
          setTimeout(() => { if (state === 'playing' && activeWebPointerId === null && !keys.space && swingCount === 1) releaseWeb(); }, 520);
        } else { state = 'start'; updateMissionUI(); }
        updateHud(0);
      }

      function endGame(reasonText) {
        state = 'gameover'; player.attached = false; player.anchor = null;
        AudioFX.playHit(); AudioFX.updateAmbient(env.wRain, 0); addScreenShake(12, 0.35); updateMissionUI();

        const finalScore = Math.floor(score);
        let isNewBest = false;
        if (finalScore > bestScore) { bestScore = finalScore; localStorage.setItem(STORAGE_KEY, String(bestScore)); isNewBest = true; }
        recordStat('bestScore', finalScore, true);
        saveAchData(true);

        document.getElementById('gameover-reason').textContent = reasonText;
        document.getElementById('go-score').textContent = finalScore.toLocaleString('vi-VN');
        document.getElementById('go-best').textContent = bestScore.toLocaleString('vi-VN');
        document.getElementById('go-dist').textContent = `${Math.floor(maxDistance)} m`;
        document.getElementById('go-speed').textContent = `${Math.floor(maxSpeedKmh)} km/h`;
        document.getElementById('gameover-newbest').classList.toggle('hidden', !(isNewBest && finalScore > 0));
        const goEl = document.getElementById('overlay-gameover'); goEl.classList.remove('hidden'); goEl.classList.add('flex');
      }

      // ============================================================
      // SIMULATION UPDATE
      // ============================================================
      function updateLivingCity(dt, L) {
        for (let i = 0; i < clouds.length; i++) { clouds[i].x -= clouds[i].speed * dt; if (clouds[i].x + clouds[i].w < -120) clouds[i].x = viewW + 180; }
        for (let i = 0; i < birds.length; i++) { const b = birds[i]; b.x += b.speed * dt; b.wing += dt * 9; if (b.x > viewW + 80) { b.x = -60; b.y = 70 + Math.random() * 185; } }
        blimp.x -= blimp.speed * dt; if (blimp.x < -180) { blimp.x = viewW + 220; blimp.y = 58 + Math.random() * 65; }
        plane.x += plane.speed * dt; if (plane.x > viewW + 300) { plane.x = -240; plane.y = 28 + Math.random() * 55; }

        for (let i = 0; i < helicopters.length; i++) {
          const h = helicopters[i]; h.x += h.speed * h.dir * dt; h.phase += dt * 4;
          if (h.x > viewW + 260) { h.dir = -1; h.y = 85 + Math.random() * 90; }
          else if (h.x < -260) { h.dir = 1; h.y = 85 + Math.random() * 90; }
        }
        subwayTrain.x += subwayTrain.speed * dt; if (subwayTrain.x > viewW + 1400) subwayTrain.x = -700 - Math.random() * 900;
        for (let i = 0; i < taxis.length; i++) { const tx = taxis[i]; tx.x += tx.speed * dt; if (tx.x > viewW + 160) tx.x = -140; if (tx.x < -160) tx.x = viewW + 140; }

        if (L.starAlpha > 0.55 && env.wRain < 0.3 && env.wFog < 0.35) {
          fireworkCooldown -= dt;
          if (fireworkCooldown <= 0) { fireworkCooldown = 2.6 + Math.random() * 4.2; spawnFirework(camX + viewW * (0.25 + Math.random() * 0.55), 85 + Math.random() * 130); }
        }
        for (let i = fireworks.length - 1; i >= 0; i--) { const fw = fireworks[i]; fw.x += fw.vx * dt; fw.y += fw.vy * dt; fw.vy += 85 * dt; fw.life -= dt * 0.92; if (fw.life <= 0) fireworks.splice(i, 1); }

        for (let i = 0; i < roofPigeons.length; i++) {
          const pg = roofPigeons[i];
          if (!pg.flying && Math.hypot(player.x - pg.x, player.y - pg.y) < 155) { pg.flying = true; pg.vx = 95 + Math.random() * 95; pg.vy = -120 - Math.random() * 80; }
          if (pg.flying) { pg.x += pg.vx * dt; pg.y += pg.vy * dt; pg.vy -= 18 * dt; pg.wing += dt * 18; }
        }

        // Rooftop + Street Manhole Steam Puffs!
        if (steamPuffs.length < (settings.liteMode ? 12 : 26) && Math.random() < dt * 7) {
          for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i]; if (!b.hasSteamVent) continue;
            const sx = b.x + b.ventOffset - camX;
            if (sx > 20 && sx < viewW - 20 && Math.random() < 0.25) { steamPuffs.push({ x: b.x + b.ventOffset, y: b.topY - 6, vx: -18 + Math.random() * 12, vy: -28 - Math.random() * 20, r: 5 + Math.random() * 5, life: 1.0 }); break; }
          }
        }
        if (streetSteam.length < (settings.liteMode ? 6 : 14) && Math.random() < dt * 5) {
          streetSteam.push({ x: camX + Math.random() * viewW, y: GROUND_Y - 2, vx: -12 + Math.random() * 8, vy: -24 - Math.random() * 18, r: 6 + Math.random() * 6, life: 1.0 });
        }
        for (let i = steamPuffs.length - 1; i >= 0; i--) { const sp = steamPuffs[i]; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.r += dt * 11; sp.life -= dt * 0.55; if (sp.life <= 0) steamPuffs.splice(i, 1); }
        for (let i = streetSteam.length - 1; i >= 0; i--) { const sp = streetSteam[i]; sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.r += dt * 12; sp.life -= dt * 0.65; if (sp.life <= 0) streetSteam.splice(i, 1); }

        const playerWindX = state === 'playing' ? player.vx * 0.30 : 40;
        const rainLimit = settings.liteMode ? Math.floor(rainDrops.length * 0.55) : rainDrops.length;
        if (env.wRain > 0.02) {
          for (let i = 0; i < rainLimit; i++) {
            const r = rainDrops[i]; r.x += (r.vx - playerWindX) * dt; r.y += r.vy * dt;
            if (r.y > GROUND_Y - camY) {
              if (rainSplashes.length < 34 && Math.random() < 0.28) rainSplashes.push({ x: r.x, y: GROUND_Y - camY + Math.random() * 18, r: 2, life: 0.26 });
              r.y = -30 - Math.random() * 60; r.x = Math.random() * (viewW + 400);
            }
            if (r.x < -60) r.x += viewW + 300;
          }
          if (rainSplashes.length < 34 && Math.random() < dt * 18 * env.wRain) {
            const b = buildings[Math.floor(Math.random() * buildings.length)];
            if (b) { const rx = b.x + Math.random() * b.w - camX; if (rx > 0 && rx < viewW) rainSplashes.push({ x: rx, y: b.topY - camY - 2, r: 1.5, life: 0.22 }); }
          }
        }
        for (let i = rainSplashes.length - 1; i >= 0; i--) { rainSplashes[i].r += dt * 36; rainSplashes[i].life -= dt; if (rainSplashes[i].life <= 0) rainSplashes.splice(i, 1); }

        const snowLimit = settings.liteMode ? Math.floor(snowFlakes.length * 0.55) : snowFlakes.length;
        if (env.wSnow > 0.02) {
          for (let i = 0; i < snowLimit; i++) {
            const s = snowFlakes[i]; s.sway += dt * 2.2; s.x += (s.vx - playerWindX * 0.25 + Math.sin(s.sway) * s.swayAmp) * dt; s.y += s.vy * dt;
            if (s.y > WORLD_H + 20) { s.y = -15; s.x = Math.random() * (viewW + 250); }
            if (s.x < -40) s.x += viewW + 180;
          }
        }
        if (env.wFog > 0.02) { for (let i = 0; i < fogBanks.length; i++) { const f = fogBanks[i]; f.x -= (f.speed + playerWindX * 0.14) * dt; if (f.x + f.w < -180) f.x = viewW + 180; } }
      }

      function updateWindEffects(dt, curSpeed) {
        const targetWind = settings.windFx ? clamp((curSpeed - 340) / 480, 0, 1) : 0;
        player.windFactor += (targetWind - player.windFactor) * Math.min(1, dt * 6);
        const targetZoom = settings.windFx ? (1.0 - player.windFactor * 0.12) : 1.0;
        if (Math.abs(targetZoom - camZoom) > 0.0008) { camZoom += (targetZoom - camZoom) * Math.min(1, dt * 4.5); viewW = window.innerWidth / (baseScale * camZoom); }

        if (settings.windFx && (player.windFactor > 0.15 || player.dashTimer > 0) && Math.random() < (0.28 + player.windFactor * 0.55)) {
          windRibbons.push({ pts: [{ x: player.x, y: player.y + (Math.random() - 0.5) * 44 }], vx: -player.vx * 0.22 - 90, vy: -player.vy * 0.15 + (Math.random() - 0.5) * 35, life: 0.42 + Math.random() * 0.25, maxLife: 0.65, width: 1.4 + player.windFactor * 2.2 });
        }
        for (let i = windRibbons.length - 1; i >= 0; i--) {
          const wr = windRibbons[i]; wr.life -= dt; const head = wr.pts[wr.pts.length - 1];
          wr.pts.push({ x: head.x + wr.vx * dt, y: head.y + wr.vy * dt + Math.sin(elapsedTime * 14 + i) * 1.4 });
          if (wr.pts.length > 10) wr.pts.shift(); if (wr.life <= 0) windRibbons.splice(i, 1);
        }

        if (settings.windFx && (player.windFactor > 0.22 || player.dashTimer > 0) && Math.random() < (player.dashTimer > 0 ? 0.85 : player.windFactor * 0.65)) {
          const y = Math.random() < 0.72 ? (Math.random() < 0.5 ? Math.random() * 190 : WORLD_H - Math.random() * 190) : Math.random() * WORLD_H;
          windStreaks.push({ x: viewW + 40, y, len: 75 + Math.random() * 170 * (0.6 + player.windFactor), speed: 1350 + player.windFactor * 1200 + Math.random() * 500, alpha: 0.12 + player.windFactor * 0.28, width: 1.2 + Math.random() * 1.6 });
        }
        for (let i = windStreaks.length - 1; i >= 0; i--) { windStreaks[i].x -= windStreaks[i].speed * dt; if (windStreaks[i].x + windStreaks[i].len < -40) windStreaks.splice(i, 1); }

        if (player.sonicRingCooldown > 0) player.sonicRingCooldown -= dt;
        if (settings.windFx && curSpeed > 700 && player.sonicRingCooldown <= 0) { player.sonicRingCooldown = 1.6; spawnShockwave(player.x, player.y, 'rgba(224, 242, 254, 0.65)', 72); }
        for (let i = shockwaves.length - 1; i >= 0; i--) { const sw = shockwaves[i]; sw.r += (sw.maxR - sw.r) * Math.min(1, dt * 10) + 120 * dt; sw.alpha -= dt * 2.4; if (sw.alpha <= 0) shockwaves.splice(i, 1); }
        AudioFX.updateAmbient(env.wRain, player.windFactor);
      }

      let frameLighting = null;
      function update(rawDt) {
        if (state === 'paused' || state === 'photo') return;

        let timeScale = 1.0;
        if (state === 'playing') {
          if (impactSlowMo > 0) { impactSlowMo = Math.max(0, impactSlowMo - rawDt); timeScale = 0.28; }
          else if (keys.focus || focusHoldActive) timeScale = 0.42;
        }
        const dt = rawDt * timeScale;
        elapsedTime += dt;
        updateEnvironment(rawDt);
        const L = getCurrentLighting();
        frameLighting = L;
        updateLivingCity(dt, L);

        if (state === 'start') {
          camX += 95 * dt; player.x = camX + viewW * 0.34; player.y = 250 + Math.sin(elapsedTime * 2.1) * 42;
          player.vx = 280; player.vy = Math.cos(elapsedTime * 2.1) * 88; player.angle = Math.atan2(player.vy, player.vx) * 0.35;
          generateParallaxSkyline(); generateBuildingsAndEntities(); updateEnvHud(); return;
        }
        if (state !== 'playing') { updateParticlesAndPopups(dt); updateEnvHud(); return; }

        const suit = SUITS[currentSuit];
        const preset = PHYSICS_PRESETS[settings.physics];
        const maxVx = preset.maxVx * (suit.perks.maxVxMult || 1);
        const scoreMult = suit.perks.scoreMult || 1;
        const stuntMult = suit.perks.stuntMult || 1;

        if (player.invulnTimer > 0) player.invulnTimer = Math.max(0, player.invulnTimer - dt);
        if (player.dashTimer > 0) player.dashTimer = Math.max(0, player.dashTimer - dt);
        if (player.shieldTimer > 0) player.shieldTimer = Math.max(0, player.shieldTimer - dt);
        if (player.magnetTimer > 0) player.magnetTimer = Math.max(0, player.magnetTimer - dt);
        if (player.skimCooldown > 0) player.skimCooldown = Math.max(0, player.skimCooldown - dt);
        if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - rawDt);
        if (player.webAnim > 0) player.webAnim = Math.max(0, player.webAnim - dt * 5.2);
        if (combo > 1) { comboTimer -= dt; if (comboTimer <= 0) combo = 1; }

        // Cosmic Auto-Shield Skill
        if (suit.perks.autoShieldSec && player.shieldTimer <= 0) {
          player.cosmicShieldCooldown -= dt;
          if (player.cosmicShieldCooldown <= 0) {
            player.shieldTimer = 5.5; player.cosmicShieldCooldown = suit.perks.autoShieldSec;
            spawnShockwave(player.x, player.y, '#38bdf8', 75);
            spawnPopup(player.x, player.y - 40, 'KHIÊN VŨ TRỤ!', '#38bdf8', 18);
          }
        }

        const speedNow = Math.hypot(player.vx, player.vy);
        if (player.dashTimer <= 0) {
          const regenBonus = (1 + env.wSunny * 0.15) * (suit.perks.dashRegenMult || 1);
          player.dashEnergy = Math.min(100, player.dashEnergy + (5 + speedNow * 0.012) * regenBonus * dt);
        }

        if (env.wSnow > 0.45) {
          player.breathTimer -= dt;
          if (player.breathTimer <= 0) { player.breathTimer = 0.55; particles.push({ x: player.x + 8, y: player.y - 16, vx: player.vx * 0.35 - 25, vy: -18, life: 0.45, maxLife: 0.45, size: 4.5, color: 'rgba(241, 245, 249, 0.55)' }); }
        }

        // Suit ambient signature particles
        if (suit.special === 'venom_hands' && Math.random() < 0.6) {
          particles.push({ x: player.x + (Math.random() - 0.5) * 28, y: player.y + (Math.random() - 0.5) * 24, vx: -player.vx * 0.14 + (Math.random() - 0.5) * 100, vy: (Math.random() - 0.5) * 100, life: 0.20, maxLife: 0.20, size: 2.3, color: Math.random() < 0.55 ? '#fde047' : '#38bdf8' });
        } else if (suit.special === 'ghost_flame' && Math.random() < 0.72) {
          particles.push({ x: player.x + (Math.random() - 0.5) * 14, y: player.y - 20, vx: -player.vx * 0.2 + (Math.random() - 0.5) * 40, vy: -45 - Math.random() * 55, life: 0.30, maxLife: 0.30, size: 3.4, color: Math.random() < 0.5 ? '#38bdf8' : '#e0f2fe' });
        } else if ((suit.special === 'tendrils' || suit.special === 'anti_tendrils') && Math.random() < 0.42) {
          particles.push({ x: player.x - 8, y: player.y + (Math.random() - 0.5) * 18, vx: -player.vx * 0.2, vy: (Math.random() - 0.5) * 45, life: 0.28, maxLife: 0.28, size: 3.6, color: suit.special === 'anti_tendrils' ? '#f8fafc' : '#09090b' });
        } else if (suit.special === 'gold_sparkle' && Math.random() < 0.55) {
          particles.push({ x: player.x + (Math.random() - 0.5) * 24, y: player.y + (Math.random() - 0.5) * 24, vx: -player.vx * 0.15, vy: -20, life: 0.32, maxLife: 0.32, size: 2.6, color: '#fef08a' });
        } else if (suit.special === 'cyber_neon' && Math.random() < 0.5) {
          particles.push({ x: player.x - 8, y: player.y + (Math.random() - 0.5) * 20, vx: -player.vx * 0.2, vy: (Math.random() - 0.5) * 50, life: 0.25, maxLife: 0.25, size: 2.6, color: Math.random() < 0.5 ? '#22d3ee' : '#ec4899' });
        } else if (suit.special === 'cosmic_stars' && Math.random() < 0.6) {
          particles.push({ x: player.x + (Math.random() - 0.5) * 26, y: player.y + (Math.random() - 0.5) * 26, vx: -player.vx * 0.12, vy: (Math.random() - 0.5) * 35, life: 0.38, maxLife: 0.38, size: 2.4, color: Math.random() < 0.5 ? '#ffffff' : '#38bdf8' });
        }

        // Physics step
        if (player.dashTimer > 0) {
          player.vy *= Math.pow(0.08, dt); player.vx = Math.max(player.vx, maxVx * 0.82);
          player.x += player.vx * dt; player.y += player.vy * dt;
          if (Math.random() < 0.65) spawnParticles(player.x - 16, player.y, 1, suit.accent, 20, 80, 2, 4);
        } else {
          let grav = preset.gravity * (1 - env.wSnow * 0.07) * (suit.perks.gravMult || 1);
          // Future Foundation Wing Glider softens fall speed!
          if (!player.attached && player.vy > 0 && suit.perks.fallDamp) grav *= suit.perks.fallDamp;
          player.vy += grav * dt;
          if (env.wRain > 0.4) player.vx += (28 * env.wRain * (0.6 + 0.4 * Math.sin(elapsedTime * 2.5))) * dt;
          if (keys.right) player.vx += (player.attached ? 430 : 220) * dt;
          if (keys.left) player.vx -= (player.attached ? 300 : 180) * dt;

          if (player.attached && player.anchor) {
            const reelSpd = preset.reel * (suit.perks.reelMult || 1);
            if (keys.up || reelHoldActive) { player.ropeLen = Math.max(85, player.ropeLen - reelSpd * dt); player.vx += 75 * dt; }
            if (keys.down) player.ropeLen = Math.min(440, player.ropeLen + 200 * dt);
            const dx0 = player.x - player.anchor.x, dy0 = player.y - player.anchor.y, dist0 = Math.hypot(dx0, dy0) || 1;
            if (dy0 > 20) { player.vx += (dy0 / dist0) * preset.pump * dt; player.vy += (-dx0 / dist0) * preset.pump * dt; }
            player.x += player.vx * dt; player.y += player.vy * dt;
            const dx = player.x - player.anchor.x, dy = player.y - player.anchor.y, dist = Math.hypot(dx, dy);
            if (dist > player.ropeLen && dist > 0.001) {
              const nx = dx / dist, ny = dy / dist;
              player.x = player.anchor.x + nx * player.ropeLen; player.y = player.anchor.y + ny * player.ropeLen;
              const radialVel = player.vx * nx + player.vy * ny;
              if (radialVel > 0) { player.vx -= radialVel * nx; player.vy -= radialVel * ny; }
            }
            if (player.x > player.anchor.x + 210 && player.vy < -30) player.ropeLen = Math.max(95, player.ropeLen - 110 * dt);
          } else {
            player.x += player.vx * dt; player.y += player.vy * dt;
            player.vx *= Math.pow(env.wSnow > 0.4 ? 0.985 : 0.96, dt);
          }
          if (player.y < 32) { player.y = 32; if (player.vy < 0) player.vy *= -0.2; }
        }

        player.vx = clamp(player.vx, -240, maxVx);
        player.vy = clamp(player.vy, -740, 840);

        if (player.flipping) {
          player.angle += player.spinVel * dt;
          if (Math.abs(player.angle) > Math.PI * 2) { player.angle %= Math.PI * 2; if (player.vy > 120) player.flipping = false; }
        } else if (player.attached && player.anchor) {
          const ropeAng = Math.atan2(player.anchor.y - player.y, player.anchor.x - player.x);
          player.angle += (ropeAng + Math.PI * 0.5 - player.angle) * Math.min(1, dt * 12);
        } else {
          player.angle += (Math.atan2(player.vy, Math.max(120, Math.abs(player.vx))) * 0.68 - player.angle) * Math.min(1, dt * 8);
        }

        const curSpeed = Math.hypot(player.vx, player.vy);
        if (curSpeed > 400 || player.dashTimer > 0 || settings.prismTrail) {
          player.trail.push({ x: player.x, y: player.y, alpha: 0.92, hue: (elapsedTime * 260) % 360 });
          if (player.trail.length > 24) player.trail.shift();
        }
        for (let i = player.trail.length - 1; i >= 0; i--) { player.trail[i].alpha -= dt * 3.2; if (player.trail[i].alpha <= 0) player.trail.splice(i, 1); }

        updateWindEffects(dt, curSpeed);

        const lookAhead = clamp(player.vx * 0.24, 0, 210);
        camX += (player.x - viewW * 0.26 + lookAhead - camX) * Math.min(1, dt * 7.5);
        camY += (clamp((player.y - 340) * 0.18, -55, 28) - camY) * Math.min(1, dt * 5.0);

        generateParallaxSkyline();
        generateBuildingsAndEntities();
        updateHeroCameos(dt);

        // Rooftop Skim
        if (player.skimCooldown <= 0 && curSpeed > 440) {
          for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i];
            if (player.x > b.x + 10 && player.x < b.x + b.w - 10) {
              const distAbove = b.topY - player.y;
              if (distAbove > 8 && distAbove < 44) {
                player.skimCooldown = 2.6;
                const pts = Math.round(180 * combo * stuntMult * scoreMult); bonusScore += pts;
                player.dashEnergy = Math.min(100, player.dashEnergy + 14);
                spawnPopup(player.x, player.y - 34, env.snowAccum > 0.35 ? `LƯỚT TUYẾT MÁI NHÀ! +${pts}` : `LƯỚT MÁI NHÀ! +${pts}`, '#38bdf8', 17);
                if (env.snowAccum > 0.25) spawnParticles(player.x, b.topY - 4, 16, '#ffffff', 50, 170, 2.5, 5);
                else if (env.wetness > 0.3) spawnParticles(player.x, b.topY - 4, 14, '#bae6fd', 50, 170, 2, 4);
                progressMission('skim', 1); recordStat('skims', 1); break;
              }
            }
          }
        }

        // Tokens
        const magnetRange = player.magnetTimer > 0 ? 245 : (suit.perks.passiveMagnet || 0);
        for (let i = 0; i < tokens.length; i++) {
          const tk = tokens[i]; if (tk.collected) continue;
          const dist = Math.hypot(player.x - tk.x, player.y - tk.y);
          if (magnetRange > 0 && dist < magnetRange) { tk.x += (player.x - tk.x) * Math.min(1, dt * 9); tk.y += (player.y - tk.y) * Math.min(1, dt * 9); }
          if (dist < tk.r + 24) {
            tk.collected = true; comboTimer = Math.max(comboTimer, 3.6);
            const pts = Math.round(100 * combo * scoreMult); bonusScore += pts;
            player.dashEnergy = Math.min(100, player.dashEnergy + 12);
            AudioFX.playToken(combo);
            spawnParticles(tk.x, tk.y, 12, '#fde047', 50, 180, 2, 4.5);
            spawnPopup(tk.x, tk.y - 16, `+${pts}`, '#fde047', 16);
            progressMission('tokens', 1); recordStat('tokensTotal', 1);
          }
        }

        // Aerial Power-Up Orbs!
        for (let i = 0; i < powerups.length; i++) {
          const pw = powerups[i]; if (pw.collected) continue;
          if (Math.hypot(player.x - pw.x, player.y - pw.y) < pw.r + 26) {
            pw.collected = true; AudioFX.playHeroTeamup();
            if (pw.type === 'overcharge') {
              player.dashEnergy = 100; player.vx = Math.max(player.vx + 200, 720);
              spawnParticles(pw.x, pw.y, 20, '#f43f5e', 80, 260, 2.5, 5);
              spawnPopup(pw.x, pw.y - 26, 'QUÁ TẢI NĂNG LƯỢNG!', '#fb7185', 19);
            } else if (pw.type === 'magnet') {
              player.magnetTimer = 7.5;
              spawnParticles(pw.x, pw.y, 20, '#facc15', 80, 260, 2.5, 5);
              spawnPopup(pw.x, pw.y - 26, 'NAM CHÂM HÚT XU (7s)!', '#fde047', 19);
            } else {
              player.shieldTimer = Math.max(player.shieldTimer, 6.5);
              spawnParticles(pw.x, pw.y, 20, '#38bdf8', 80, 260, 2.5, 5);
              spawnPopup(pw.x, pw.y - 26, 'KHIÊN BẢO VỆ (6s)!', '#38bdf8', 19);
            }
          }
        }

        // Boost Rings
        for (let i = 0; i < boostRings.length; i++) {
          const ring = boostRings[i]; if (ring.triggered) continue;
          if (Math.hypot(player.x - ring.x, player.y - ring.y) < ring.r + 18) {
            ring.triggered = true;
            player.vx = Math.max(player.vx + 250, 740); player.vy = Math.min(player.vy - 90, -140);
            player.dashEnergy = Math.min(100, player.dashEnergy + 35);
            combo = Math.min(10, combo + 1); comboTimer = 4.6; recordStat('maxCombo', combo, true);
            const pts = Math.round(250 * combo * scoreMult); bonusScore += pts;
            AudioFX.playBoost(); addScreenShake(6, 0.18);
            spawnShockwave(ring.x, ring.y, 'rgba(56, 189, 248, 0.85)', 88);
            spawnParticles(ring.x, ring.y, 20, '#38bdf8', 80, 260, 2.5, 5.5);
            spawnPopup(ring.x, ring.y - 30, `VÒNG SIÊU TỐC! +${pts}`, '#38bdf8', 20);
          }
        }

        // Drones
        let dangerNear = false;
        const senseRadius = 175 + env.wFog * 165 + (suit.perks.reachMult ? 60 : 0);
        if (gameMode === 'arcade') {
          for (let i = 0; i < drones.length; i++) {
            const d = drones[i]; if (!d.alive) continue;
            d.y = d.baseY + Math.sin(elapsedTime * d.freq + d.phase) * d.amp;
            const dist = Math.hypot(player.x - d.x, player.y - d.y);
            if (dist < senseRadius) dangerNear = true;

            if (dist < d.r + 22) {
              if (player.dashTimer > 0 || player.shieldTimer > 0) {
                d.alive = false; combo = Math.min(10, combo + 1); comboTimer = 4.6; recordStat('maxCombo', combo, true);
                const pts = Math.round(400 * combo * scoreMult); bonusScore += pts;
                player.dashEnergy = Math.min(100, player.dashEnergy + (suit.perks.smashDashBonus || 28));
                AudioFX.playSmash(); addScreenShake(9, 0.25);
                spawnParticles(d.x, d.y, 26, suit.special === 'ghost_flame' ? '#38bdf8' : '#fb923c', 90, 320, 3, 6);
                spawnPopup(d.x, d.y - 28, player.shieldTimer > 0 ? `KHIÊN PHÁ DRONE! +${pts}` : `PHÁ DRONE! +${pts}`, '#fb923c', 22);
                progressMission('smash', 1); recordStat('smashes', 1);
              } else if (player.invulnTimer <= 0) {
                d.alive = false; player.hearts--; player.invulnTimer = 1.4;
                combo = 1; player.vx = Math.max(160, player.vx * 0.55); player.vy = -210;
                AudioFX.playHit(); addScreenShake(11, 0.3);
                spawnParticles(d.x, d.y, 22, '#ef4444', 80, 260, 3, 6);
                spawnPopup(player.x, player.y - 35, 'TRÚNG DRONE!', '#f87171', 21);
                if (player.hearts <= 0) { endGame('Drone của Green Goblin đã hạ gục Người Nhện!'); return; }
              }
            } else if (!d.nearMissed && dist < d.r + 54 && player.x > d.x + 14) {
              d.nearMissed = true;
              const pts = Math.round(150 * combo * stuntMult * scoreMult); bonusScore += pts;
              spawnPopup(player.x, player.y - 36, `NÉ SÁT NÚT! +${pts}`, '#a7f3d0', 17);
            }
          }
        }

        updateBossEncounters(dt);
        if (state !== 'playing') return;

        if (player.y > GROUND_Y - 115) dangerNear = true;
        if (player.y >= GROUND_Y - 12) {
          if (gameMode === 'zen') {
            player.y = GROUND_Y - 14; player.vy = -520; player.vx = Math.max(player.vx, 390);
            player.attached = false; player.anchor = null;
            AudioFX.playThwip(suit.soundType);
            spawnParticles(player.x, GROUND_Y - 10, 14, env.snowAccum > 0.3 ? '#ffffff' : '#38bdf8', 60, 190, 2, 4.5);
            spawnPopup(player.x, player.y - 30, 'TƠ AN TOÀN!', '#38bdf8', 18);
          } else {
            player.y = GROUND_Y - 12;
            endGame('Người Nhện đã rơi xuống đại lộ Manhattan!');
            return;
          }
        }

        player.spiderSense = dangerNear ? Math.min(1, player.spiderSense + dt * 6) : Math.max(0, player.spiderSense - dt * 4);

        // Distance, Cumulative Total Distance, District Transitions & Anti-Venom Auto-Heal!
        const distM = Math.max(0, (player.x - startX) / 14);
        if (distM > maxDistance) {
          const delta = distM - lastRecordedDist;
          if (delta >= 1) {
            recordStat('totalDist', delta, false);
            lastRecordedDist = distM;
          }
          maxDistance = distM;
          recordStat('maxDist', distM, true);

          // Dynamic NYC District Transition every 350m!
          const nextDistIdx = Math.floor(maxDistance / 350) % DISTRICTS.length;
          if (nextDistIdx !== currentDistrictIdx) {
            currentDistrictIdx = nextDistIdx;
            updateMissionUI();
            showToast('📍', `Đang tiến vào khu vực: ${DISTRICTS[currentDistrictIdx].name}`);
          }

          // Anti-Venom Skill: Auto-heal +1 Heart every 350m!
          if (suit.perks.healEveryMeters && maxDistance >= player.nextHealDist) {
            player.nextHealDist += suit.perks.healEveryMeters;
            if (player.hearts < player.maxHearts) {
              player.hearts++;
              AudioFX.playHeroTeamup();
              spawnPopup(player.x, player.y - 44, 'KHÁNG THỂ +1 TIM!', '#f8fafc', 19);
            }
          }
        }

        const speedKmh = Math.round(curSpeed * 0.24);
        if (speedKmh > maxSpeedKmh) { maxSpeedKmh = speedKmh; recordStat('maxSpeed', speedKmh, true); }
        progressMission('speed', speedKmh, true);
        score = maxDistance * 5 * scoreMult + bonusScore;
        if (score >= 25000) recordStat('bestScore', Math.floor(score), true);

        updateParticlesAndPopups(dt);
        updateHud(speedKmh);
      }

      function updateParticlesAndPopups(dt) {
        for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 290 * dt; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); }
        for (let i = popups.length - 1; i >= 0; i--) { const pop = popups[i]; pop.y += pop.vy * dt; pop.life -= dt * 1.05; if (pop.life <= 0) popups.splice(i, 1); }
      }

      // ============================================================
      // HUD UPDATES
      // ============================================================
      const elScore = document.getElementById('hud-score'), elDistance = document.getElementById('hud-distance'), elSpeed = document.getElementById('hud-speed');
      const elCombo = document.getElementById('hud-combo-badge'), elHearts = document.getElementById('hud-hearts'), elHeartsWrap = document.getElementById('hud-hearts-wrap');
      const elBuffs = document.getElementById('hud-buffs'), elDashBar = document.getElementById('dash-bar'), elDashText = document.getElementById('dash-status-text'), btnDash = document.getElementById('btn-dash');
      const elWeatherIcon = document.getElementById('hud-weather-icon'), elWeatherLabel = document.getElementById('hud-weather-label'), elWeatherTimer = document.getElementById('hud-weather-timer');
      const elFps = document.getElementById('hud-fps');

      const hudCache = {
        weatherKey: '', weatherTimer: '', autoWeather: null,
        score: -1, dist: -1, speed: -1, combo: -1,
        heartsKey: '', buffsKey: '', dashPct: -1, dashDisabled: null, dashText: '', dashCls: ''
      };

      function updateEnvHud() {
        const meta = WEATHER_META[env.targetWeather];
        if (hudCache.weatherKey !== env.targetWeather) {
          hudCache.weatherKey = env.targetWeather;
          elWeatherIcon.textContent = meta.icon;
          elWeatherLabel.textContent = meta.label;
        }
        if (hudCache.autoWeather !== env.autoWeather) {
          hudCache.autoWeather = env.autoWeather;
          elWeatherTimer.classList.toggle('hidden', !env.autoWeather);
        }
        if (env.autoWeather) {
          const tStr = `0:${String(Math.max(0, Math.ceil(env.weatherTimer))).padStart(2, '0')}`;
          if (hudCache.weatherTimer !== tStr) { hudCache.weatherTimer = tStr; elWeatherTimer.textContent = tStr; }
        }
      }

      function updateHud(speedKmh = 0) {
        const sInt = Math.floor(score), dInt = Math.floor(maxDistance);
        if (hudCache.score !== sInt) { hudCache.score = sInt; elScore.textContent = sInt.toLocaleString('vi-VN'); }
        if (hudCache.dist !== dInt) { hudCache.dist = dInt; elDistance.textContent = dInt.toLocaleString('vi-VN'); }
        if (hudCache.speed !== speedKmh) { hudCache.speed = speedKmh; elSpeed.textContent = speedKmh; }
        if (hudCache.combo !== combo) {
          hudCache.combo = combo;
          if (combo > 1) { elCombo.classList.remove('hidden'); elCombo.textContent = `x${combo}`; }
          else elCombo.classList.add('hidden');
        }

        const heartsKey = gameMode === 'arcade' ? `${player.hearts}/${player.maxHearts}` : 'zen';
        if (hudCache.heartsKey !== heartsKey) {
          hudCache.heartsKey = heartsKey;
          if (gameMode === 'arcade') {
            elHeartsWrap.classList.remove('hidden');
            let hHtml = '';
            for (let i = 0; i < player.maxHearts; i++) hHtml += `<span class="${i < player.hearts ? 'text-rose-500' : 'text-slate-600'}">♥</span>`;
            elHearts.innerHTML = hHtml;
          } else elHeartsWrap.classList.add('hidden');
        }

        const shSec = player.shieldTimer > 0 ? Math.ceil(player.shieldTimer) : 0;
        const mgSec = player.magnetTimer > 0 ? Math.ceil(player.magnetTimer) : 0;
        const buffsKey = `${shSec}|${mgSec}`;
        if (hudCache.buffsKey !== buffsKey) {
          hudCache.buffsKey = buffsKey;
          let buffHtml = '';
          if (shSec > 0) buffHtml += `<span class="px-1.5 py-0.5 rounded-md bg-sky-500/30 border border-sky-400/50 text-[10px] font-bold text-sky-200">🛡️${shSec}s</span>`;
          if (mgSec > 0) buffHtml += `<span class="px-1.5 py-0.5 rounded-md bg-amber-500/30 border border-amber-400/50 text-[10px] font-bold text-amber-200">🧲${mgSec}s</span>`;
          elBuffs.innerHTML = buffHtml;
        }

        const pct = Math.round(player.dashEnergy);
        if (hudCache.dashPct !== pct) { hudCache.dashPct = pct; elDashBar.style.width = `${pct}%`; }
        const canDash = player.dashEnergy >= 50;
        const disabled = !canDash || state !== 'playing';
        if (hudCache.dashDisabled !== disabled) { hudCache.dashDisabled = disabled; btnDash.disabled = disabled; }
        const dText = canDash ? (pct >= 100 ? 'Đầy (x2)' : 'Sẵn sàng') : `${pct}%`;
        if (hudCache.dashText !== dText) { hudCache.dashText = dText; elDashText.textContent = dText; }
        const dCls = canDash ? 'text-amber-300' : 'text-slate-400';
        if (hudCache.dashCls !== dCls) { hudCache.dashCls = dCls; elDashText.className = dCls; }
        updateEnvHud();
      }

      // ============================================================
      // RENDERING PIPELINE
      // ============================================================
      function drawSkyAndAtmosphere(L) {
        const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
        grad.addColorStop(0, rgbStr(L.skyTop)); grad.addColorStop(0.55, rgbStr(L.skyMid)); grad.addColorStop(1, rgbStr(L.skyBot));
        ctx.fillStyle = grad; ctx.fillRect(0, 0, viewW, WORLD_H);

        if (env.lightningFlash > 0.02) { ctx.fillStyle = `rgba(224, 242, 254, ${env.lightningFlash * 0.44})`; ctx.fillRect(0, 0, viewW, WORLD_H); }

        if (L.starAlpha > 0.03) {
          for (let i = 0; i < stars.length; i++) {
            const s = stars[i], tw = 0.55 + 0.45 * Math.sin(elapsedTime * 2.3 + s.twinkle);
            ctx.fillStyle = `rgba(255, 255, 255, ${(L.starAlpha * tw * 0.88).toFixed(3)})`;
            ctx.beginPath(); ctx.arc(s.rx * viewW, s.ry * WORLD_H, s.size, 0, Math.PI * 2); ctx.fill();
          }
        }
        for (let i = 0; i < fireworks.length; i++) {
          const fw = fireworks[i]; ctx.fillStyle = fw.color; ctx.globalAlpha = clamp(fw.life, 0, 1);
          ctx.beginPath(); ctx.arc(fw.x - camX, fw.y - camY, fw.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;

        const sunVisibility = clamp(1 - env.wRain * 0.85 - env.wFog * 0.78 - env.wSnow * 0.65, 0, 1);
        if (env.dayTime > 0.20 && env.dayTime < 0.83) {
          const sunProg = (env.dayTime - 0.22) / 0.58;
          const sx = viewW * (0.14 + sunProg * 0.72), sy = WORLD_H * (0.58 - Math.sin(clamp(sunProg, 0, 1) * Math.PI) * 0.44);
          const isLow = sunProg < 0.18 || sunProg > 0.80, sunR = isLow ? 52 : 38;
          if (sunVisibility > 0.05) {
            const halo = ctx.createRadialGradient(sx, sy, sunR * 0.25, sx, sy, sunR * 4.4);
            halo.addColorStop(0, isLow ? `rgba(253, 224, 71, ${0.62 * sunVisibility})` : `rgba(255, 251, 235, ${0.62 * sunVisibility})`);
            halo.addColorStop(0.45, isLow ? `rgba(251, 146, 60, ${0.26 * sunVisibility})` : `rgba(254, 240, 138, ${0.22 * sunVisibility})`);
            halo.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, sunR * 4.4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = isLow ? '#fde047' : '#fffbeb'; ctx.globalAlpha = sunVisibility;
            ctx.beginPath(); ctx.arc(sx, sy, sunR, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
            if (env.wSunny > 0.25 && L.daylight > 0.35) {
              ctx.save(); ctx.globalAlpha = env.wSunny * L.daylight * 0.13; ctx.fillStyle = isLow ? '#fed7aa' : '#fef9c3';
              for (let r = 0; r < 4; r++) { ctx.beginPath(); ctx.moveTo(sx, sy); const bx1 = sx - 260 + r * 175; ctx.lineTo(bx1, WORLD_H); ctx.lineTo(bx1 + 98, WORLD_H); ctx.closePath(); ctx.fill(); }
              ctx.restore();
            }
          }
        }

        const nightPhase = env.dayTime >= 0.78 ? (env.dayTime - 0.78) / 0.46 : (env.dayTime + 0.22) / 0.46;
        if ((env.dayTime >= 0.78 || env.dayTime <= 0.24) && L.starAlpha > 0.15) {
          const mx = viewW * (0.18 + clamp(nightPhase, 0, 1) * 0.66), my = WORLD_H * (0.46 - Math.sin(clamp(nightPhase, 0, 1) * Math.PI) * 0.30);
          const moonAlpha = clamp(L.starAlpha * (1 - env.wRain * 0.7 - env.wFog * 0.7), 0, 1);
          if (moonAlpha > 0.05) {
            const mHalo = ctx.createRadialGradient(mx, my, 8, mx, my, 120);
            mHalo.addColorStop(0, `rgba(226, 232, 240, ${0.38 * moonAlpha})`); mHalo.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = mHalo; ctx.beginPath(); ctx.arc(mx, my, 120, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgba(241, 245, 249, ${moonAlpha})`; ctx.beginPath(); ctx.arc(mx, my, 29, 0, Math.PI * 2); ctx.fill();
          }
        }

        if (env.lightningBolt && env.lightningFlash > 0.12) {
          ctx.save(); ctx.strokeStyle = `rgba(240, 249, 255, ${env.lightningFlash})`; ctx.lineWidth = 3.2;
          ctx.beginPath(); ctx.moveTo(env.lightningBolt[0].x, env.lightningBolt[0].y);
          for (let i = 1; i < env.lightningBolt.length; i++) ctx.lineTo(env.lightningBolt[i].x, env.lightningBolt[i].y);
          ctx.stroke(); ctx.restore();
        }

        // High-altitude JFK/LaGuardia Airplane with blinking wingtip lights!
        ctx.save();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.7)';
        ctx.fillRect(plane.x, plane.y, 14, 2.5);
        ctx.fillRect(plane.x + 5, plane.y - 4, 3, 10);
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(plane.x - 2, plane.y + 1); ctx.lineTo(plane.x - 42, plane.y + 1); ctx.stroke();
        if (Math.sin(elapsedTime * 8) > 0) {
          ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(plane.x + 6, plane.y - 4, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(plane.x + 6, plane.y + 6, 1.8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

        // NYC Advertising Blimp
        ctx.save(); ctx.translate(blimp.x, blimp.y + Math.sin(elapsedTime * 1.5) * 4);
        ctx.fillStyle = L.daylight > 0.45 ? '#e2e8f0' : '#334155'; ctx.beginPath(); ctx.ellipse(0, 0, 32, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e11d48'; ctx.fillRect(-16, -3, 32, 6); ctx.fillStyle = '#0f172a'; ctx.fillRect(-8, 10, 16, 4);
        ctx.fillStyle = '#fde047'; ctx.font = '800 5.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('NYC', 0, 2);
        ctx.restore();

        const cloudColor = env.wRain > 0.4 ? (L.daylight > 0.45 ? [100, 116, 139] : [30, 41, 59]) : (L.daylight > 0.45 ? [255, 255, 255] : [148, 163, 184]);
        const cloudBoost = 1 + env.wRain * 0.9 + env.wSnow * 0.55;
        for (let i = 0; i < clouds.length; i++) {
          const c = clouds[i]; ctx.fillStyle = rgbStr(cloudColor, clamp(c.alpha * cloudBoost, 0.06, 0.54));
          ctx.beginPath(); ctx.roundRect(c.x, c.y, c.w, c.h, c.h * 0.5); ctx.roundRect(c.x + c.w * 0.18, c.y - c.h * 0.42, c.w * 0.52, c.h * 0.9, c.h * 0.45); ctx.fill();
        }
        if (env.wSunny > 0.35 && L.daylight > 0.45) {
          ctx.save(); ctx.strokeStyle = `rgba(30, 41, 59, ${env.wSunny * 0.55})`; ctx.lineWidth = 1.6;
          for (let i = 0; i < birds.length; i++) {
            const b = birds[i], flap = Math.sin(b.wing) * 3.5;
            ctx.beginPath(); ctx.moveTo(b.x - b.size, b.y + flap); ctx.quadraticCurveTo(b.x - b.size * 0.4, b.y - 2, b.x, b.y); ctx.quadraticCurveTo(b.x + b.size * 0.4, b.y - 2, b.x + b.size, b.y + flap); ctx.stroke();
          }
          ctx.restore();
        }
      }

      function drawLandmarks(L) {
        const off = camX * 0.24, baseColor = lerpRgb(L.farCity, L.midCity, 0.45);
        for (let i = 0; i < landmarks.length; i++) {
          const lm = landmarks[i], x = lm.x - off;
          if (x > viewW + 260 || x + lm.w < -260) continue;
          const yBase = GROUND_Y;

          if (lm.type === 'liberty') {
            ctx.fillStyle = L.daylight > 0.45 ? 'rgba(14, 165, 233, 0.35)' : 'rgba(15, 23, 42, 0.55)'; ctx.fillRect(x - 30, yBase - 42, 260, 42);
            ctx.fillStyle = rgbStr(lerpRgb(baseColor, [168, 152, 132], 0.35)); ctx.fillRect(x + 28, yBase - 142, 54, 142); ctx.fillRect(x + 36, yBase - 188, 38, 48);
            const copper = rgbStr(lerpRgb(baseColor, [45, 212, 191], 0.52 * L.daylight + 0.28));
            ctx.fillStyle = copper; ctx.beginPath(); ctx.moveTo(x + 38, yBase - 188); ctx.lineTo(x + 45, yBase - 280); ctx.lineTo(x + 64, yBase - 280); ctx.lineTo(x + 71, yBase - 188); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.arc(x + 54, yBase - 289, 8, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = copper; ctx.lineWidth = 1.8;
            for (let r = -3; r <= 3; r++) { const a = -Math.PI * 0.5 + r * 0.35; ctx.beginPath(); ctx.moveTo(x + 54 + Math.cos(a) * 7, yBase - 289 + Math.sin(a) * 7); ctx.lineTo(x + 54 + Math.cos(a) * 16, yBase - 289 + Math.sin(a) * 16); ctx.stroke(); }
            ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(x + 62, yBase - 266); ctx.lineTo(x + 74, yBase - 318); ctx.stroke();
            const fHalo = ctx.createRadialGradient(x + 74, yBase - 324, 2, x + 74, yBase - 324, 26);
            fHalo.addColorStop(0, 'rgba(253, 224, 71, 0.85)'); fHalo.addColorStop(1, 'rgba(251, 146, 60, 0)');
            ctx.fillStyle = fHalo; ctx.beginPath(); ctx.arc(x + 74, yBase - 324, 26, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(x + 74, yBase - 324, 5 + Math.sin(elapsedTime * 8) * 1, 0, Math.PI * 2); ctx.fill();
            const fx = x + 135 + Math.sin(elapsedTime * 0.5) * 24;
            ctx.fillStyle = '#f97316'; ctx.fillRect(fx, yBase - 48, 38, 10); ctx.fillStyle = '#f8fafc'; ctx.fillRect(fx + 5, yBase - 54, 26, 6); ctx.fillStyle = '#fef08a'; ctx.fillRect(fx + 8, yBase - 52, 20, 3);
          } else if (lm.type === 'avengers') {
            ctx.fillStyle = rgbStr(lerpRgb(baseColor, [56, 130, 196], 0.35 * L.daylight + 0.15));
            ctx.beginPath(); ctx.moveTo(x + 10, yBase + 20); ctx.lineTo(x + 14, yBase - 420); ctx.lineTo(x + 88, yBase - 470); ctx.lineTo(x + 96, yBase - 340); ctx.lineTo(x + 118, yBase - 340); ctx.lineTo(x + 118, yBase - 325); ctx.lineTo(x + 96, yBase - 325); ctx.lineTo(x + 96, yBase + 20); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 14, yBase - 420, 4, 420);
            ctx.font = '900 32px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('A', x + 56, yBase - 372);
          } else if (lm.type === 'park_wheel') {
            const wx = x + 225, wy = yBase - 190, wr = 72;
            ctx.strokeStyle = rgbStr(lerpRgb(baseColor, [244, 63, 94], 0.4)); ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.moveTo(wx - 34, yBase - 40); ctx.lineTo(wx, wy); ctx.lineTo(wx + 34, yBase - 40); ctx.stroke();
            ctx.strokeStyle = L.windowGlow > 0.3 ? '#38bdf8' : rgbStr(lerpRgb(baseColor, [250, 204, 21], 0.45)); ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(wx, wy, wr, 0, Math.PI * 2); ctx.stroke();
            const wheelRot = elapsedTime * 0.35, podCols = ['#f43f5e', '#facc15', '#38bdf8', '#4ade80'];
            for (let p = 0; p < 12; p++) {
              const a = wheelRot + (p / 12) * Math.PI * 2, px = wx + Math.cos(a) * wr, py = wy + Math.sin(a) * wr;
              ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(px, py); ctx.stroke();
              ctx.fillStyle = podCols[p % podCols.length]; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, Math.PI * 2); ctx.fill();
            }
            for (let t = 0; t < 8; t++) {
              ctx.fillStyle = t % 3 === 0 ? (L.daylight > 0.4 ? '#d97706' : '#78350f') : (L.daylight > 0.4 ? '#15803d' : '#14532d');
              ctx.beginPath(); ctx.arc(x + 15 + t * 38, yBase - 58 - (t % 2) * 14, 28 + (t % 3) * 6, 0, Math.PI * 2); ctx.fill();
            }
          } else if (lm.type === 'flatiron') {
            ctx.fillStyle = rgbStr(lerpRgb(baseColor, [214, 192, 162], 0.45 * L.daylight + 0.12));
            ctx.beginPath(); ctx.moveTo(x + 28, yBase + 20); ctx.lineTo(x + 36, yBase - 315); ctx.lineTo(x + 76, yBase - 315); ctx.lineTo(x + 88, yBase + 20); ctx.closePath(); ctx.fill();
            ctx.fillStyle = rgbStr(lerpRgb(baseColor, [120, 100, 82], 0.4)); ctx.fillRect(x + 32, yBase - 323, 48, 9);
          } else if (lm.type === 'empire') {
            ctx.fillStyle = rgbStr(baseColor);
            ctx.fillRect(x, yBase - 310, 96, 330); ctx.fillRect(x + 12, yBase - 405, 72, 96); ctx.fillRect(x + 24, yBase - 455, 48, 52); ctx.fillRect(x + 36, yBase - 492, 24, 38); ctx.fillRect(x + 46, yBase - 565, 4, 75);
            if (L.windowGlow > 0.25) {
              ctx.fillStyle = `rgba(244, 63, 94, ${L.windowGlow * 0.9})`; ctx.fillRect(x + 36, yBase - 492, 24, 10);
              ctx.fillStyle = `rgba(56, 189, 248, ${L.windowGlow * 0.8})`; ctx.fillRect(x + 24, yBase - 455, 48, 6);
              ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(x + 48, yBase - 566, 3.4, 0, Math.PI * 2); ctx.fill();
            }
          } else if (lm.type === 'chrysler') {
            ctx.fillStyle = rgbStr(baseColor); ctx.fillRect(x + 6, yBase - 335, 82, 355); ctx.fillRect(x + 16, yBase - 395, 62, 62);
            for (let t = 0; t < 4; t++) { ctx.beginPath(); ctx.arc(x + 47, yBase - 395 - t * 14, 30 - t * 6, Math.PI, 0); ctx.fill(); }
            ctx.fillRect(x + 45.5, yBase - 492, 3, 52);
            if (L.windowGlow > 0.28) { ctx.fillStyle = `rgba(254, 240, 138, ${L.windowGlow * 0.85})`; for (let t = 0; t < 3; t++) ctx.fillRect(x + 34 + t * 10, yBase - 418 - t * 11, 5, 4); }
          } else if (lm.type === 'wtc') {
            ctx.fillStyle = rgbStr(baseColor);
            ctx.beginPath(); ctx.moveTo(x + 6, yBase + 20); ctx.lineTo(x + 22, yBase - 468); ctx.lineTo(x + 76, yBase - 468); ctx.lineTo(x + 92, yBase + 20); ctx.closePath(); ctx.fill();
            ctx.fillStyle = `rgba(125, 211, 252, ${0.20 + L.daylight * 0.24})`;
            ctx.beginPath(); ctx.moveTo(x + 49, yBase - 468); ctx.lineTo(x + 76, yBase - 468); ctx.lineTo(x + 92, yBase + 20); ctx.lineTo(x + 49, yBase + 20); ctx.closePath(); ctx.fill();
            ctx.fillStyle = rgbStr(baseColor); ctx.fillRect(x + 47.5, yBase - 555, 3, 88);
          } else if (lm.type === 'bridge') {
            const deckY = yBase - 125, t1 = x + 95, t2 = x + 395, towerTop = deckY - 170;
            [t1, t2].forEach((tx) => {
              ctx.fillStyle = rgbStr(lerpRgb(baseColor, [160, 144, 128], 0.28)); ctx.fillRect(tx - 24, towerTop, 48, 305);
              ctx.fillStyle = rgbStr(L.skyBot, 0.55); ctx.beginPath(); ctx.roundRect(tx - 16, towerTop + 36, 12, 58, [8, 8, 0, 0]); ctx.roundRect(tx + 4, towerTop + 36, 12, 58, [8, 8, 0, 0]); ctx.fill();
              if (env.snowAccum > 0.1) { ctx.fillStyle = `rgba(248, 250, 252, ${env.snowAccum * 0.9})`; ctx.fillRect(tx - 25, towerTop - 3, 50, 5 * env.snowAccum + 1); }
            });
            ctx.fillStyle = rgbStr(baseColor); ctx.fillRect(x, deckY, 500, 12);
            if (env.snowAccum > 0.08) { ctx.fillStyle = `rgba(248, 250, 252, ${env.snowAccum * 0.92})`; ctx.fillRect(x, deckY - 3, 500, 4 * env.snowAccum + 1); }
            ctx.strokeStyle = env.snowAccum > 0.45 ? 'rgba(226, 232, 240, 0.85)' : rgbStr(baseColor); ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(x, deckY); ctx.quadraticCurveTo(t1 - 40, deckY - 25, t1, towerTop + 8); ctx.quadraticCurveTo((t1 + t2) * 0.5, deckY - 18, t2, towerTop + 8); ctx.quadraticCurveTo(t2 + 40, deckY - 25, x + 500, deckY); ctx.stroke();
            ctx.lineWidth = 1.2; ctx.beginPath();
            for (let sx = t1 + 18; sx < t2; sx += 22) { const p = (sx - t1) / (t2 - t1); ctx.moveTo(sx, towerTop + 8 + Math.sin(p * Math.PI) * (deckY - towerTop - 16)); ctx.lineTo(sx, deckY); }
            ctx.stroke();
            if (L.windowGlow > 0.3) {
              ctx.fillStyle = `rgba(253, 224, 71, ${L.windowGlow * 0.88})`;
              for (let sx = t1 + 14; sx < t2; sx += 28) { const p = (sx - t1) / (t2 - t1); ctx.beginPath(); ctx.arc(sx, towerTop + 8 + Math.sin(p * Math.PI) * (deckY - towerTop - 16), 2.2, 0, Math.PI * 2); ctx.fill(); }
            }
          }
        }
      }

      function drawParallaxCities(L) {
        ctx.fillStyle = rgbStr(L.farCity);
        const farOff = camX * 0.16;
        for (let i = 0; i < farSkyline.length; i++) {
          const b = farSkyline[i], x = b.x - farOff, y = GROUND_Y - b.h;
          ctx.fillRect(x, y, b.w, b.h + 50);
          if (b.stepped) ctx.fillRect(x + b.w * 0.16, y - 20, b.w * 0.68, 20);
          if (b.spireH > 0) ctx.fillRect(x + b.w * 0.5 - 1.5, y - b.spireH, 3, b.spireH);
        }
        drawLandmarks(L);

        for (let i = 0; i < helicopters.length; i++) {
          const h = helicopters[i], hx = h.x, hy = h.y + Math.sin(h.phase) * 5;
          ctx.save();
          if (L.windowGlow > 0.35 || env.wFog > 0.35) {
            const beamAlpha = Math.max(L.windowGlow * 0.24, env.wFog * 0.22);
            const grad = ctx.createLinearGradient(hx, hy, hx + h.dir * 85, hy + 210);
            grad.addColorStop(0, `rgba(254, 249, 195, ${beamAlpha})`); grad.addColorStop(1, 'rgba(254, 249, 195, 0)');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(hx, hy + 3); ctx.lineTo(hx + h.dir * 40, hy + 210); ctx.lineTo(hx + h.dir * 130, hy + 210); ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.ellipse(hx, hy, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(hx - h.dir * 20, hy - 2, 14, 3);
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.58)'; ctx.lineWidth = 1.5;
          const rotW = 14 + Math.sin(elapsedTime * 42) * 5; ctx.beginPath(); ctx.moveTo(hx - rotW, hy - 7); ctx.lineTo(hx + rotW, hy - 7); ctx.stroke();
          if (Math.sin(elapsedTime * 7) > 0.2) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(hx, hy + 3, 2.2, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        }

        const midOff = camX * 0.42;
        const midWarmCol = L.windowGlow > 0.18 ? `rgba(254, 240, 138, ${(L.windowGlow * 0.66).toFixed(2)})` : '';
        const midCoolCol = L.windowGlow > 0.18 ? `rgba(125, 211, 252, ${(L.windowGlow * 0.58).toFixed(2)})` : '';
        for (let i = 0; i < midSkyline.length; i++) {
          const b = midSkyline[i], x = b.x - midOff; if (x > viewW + 90 || x + b.w < -90) continue;
          const y = GROUND_Y - b.h, tints = [[52, 88, 136], [134, 72, 62], [36, 108, 118], [122, 104, 86]];
          ctx.fillStyle = rgbStr(lerpRgb(L.midCity, tints[b.hueShift], 0.26 * L.daylight + 0.08));
          if (b.slanted) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y + 50); ctx.lineTo(x, y + 26); ctx.lineTo(x + b.w, y); ctx.lineTo(x + b.w, GROUND_Y + 50); ctx.closePath(); ctx.fill(); }
          else ctx.fillRect(x, y, b.w, b.h + 50);
          if (env.snowAccum > 0.06 && !b.slanted) { ctx.fillStyle = `rgba(248, 250, 252, ${(env.snowAccum * 0.85).toFixed(2)})`; ctx.fillRect(x, y - 2, b.w, 5 * env.snowAccum + 1); }
          if (b.hasAntenna) {
            ctx.fillStyle = rgbStr(L.midCity); ctx.fillRect(x + b.w * 0.5 - 1.5, y - 40, 3, 40);
            if (Math.sin(elapsedTime * 3.5 + b.seed) > 0.15) { ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x + b.w * 0.5, y - 41, 2.6, 0, Math.PI * 2); ctx.fill(); }
          }
          if (L.windowGlow > 0.18) {
            if (b.warmWins.length) {
              ctx.fillStyle = midWarmCol;
              for (let k = 0; k < b.warmWins.length; k += 2) ctx.fillRect(x + b.warmWins[k], y + b.warmWins[k + 1], 6, 9);
            }
            if (b.coolWins.length) {
              ctx.fillStyle = midCoolCol;
              for (let k = 0; k < b.coolWins.length; k += 2) ctx.fillRect(x + b.coolWins[k], y + b.coolWins[k + 1], 6, 9);
            }
          }
        }
      }

      function drawFogLayer(layerIdx, L) {
        if (env.wFog < 0.02) return;
        const spr = L.daylight > 0.45 ? GLOW_SPRITES.fogLight : GLOW_SPRITES.fogDark;
        ctx.save();
        ctx.globalAlpha = clamp(env.wFog * (layerIdx === 0 ? 0.44 : 0.36), 0, 1);
        for (let i = 0; i < fogBanks.length; i++) {
          const f = fogBanks[i]; if (f.layer !== layerIdx) continue;
          ctx.drawImage(spr, f.x - f.w * 0.05, f.y - f.h, f.w * 1.1, f.h * 2);
        }
        ctx.restore();
      }

      function drawForegroundBuildings(L) {
        for (let i = 0; i < buildings.length; i++) {
          const b = buildings[i], x = b.x - camX;
          if (x > viewW + 110 || x + b.w < -110) continue;
          const y = b.topY - camY, h = GROUND_Y - b.topY + 85;

          let styleBase;
          if (b.style === 'sapphire_glass')      styleBase = lerpRgb([24, 54, 96],   [56, 134, 204], L.daylight);
          else if (b.style === 'emerald_tower')  styleBase = lerpRgb([16, 56, 66],   [32, 138, 144], L.daylight);
          else if (b.style === 'artdeco_gold')   styleBase = lerpRgb([58, 48, 58],   [206, 182, 148], L.daylight);
          else if (b.style === 'times_media')    styleBase = lerpRgb([30, 30, 52],   [76, 86, 122],  L.daylight);
          else                                   styleBase = lerpRgb([102, 42, 34],  [196, 82, 56],  L.daylight);

          if (env.wetness > 0.05) styleBase = lerpRgb(styleBase, [styleBase[0] * 0.78, styleBase[1] * 0.80, styleBase[2] * 0.86], env.wetness * 0.6);

          const facadeRgb = lerpRgb(styleBase, L.nearTint, 0.13);
          const sideRgb   = lerpRgb(facadeRgb, [6, 10, 20], 0.42);

          ctx.fillStyle = rgbStr(sideRgb); ctx.fillRect(x - 12, y + 4, 12, h);
          ctx.fillStyle = rgbStr(facadeRgb); ctx.fillRect(x, y, b.w, h);

          ctx.fillStyle = 'rgba(0, 0, 0, 0.11)';
          for (let fy = y + 44; fy < GROUND_Y - 56 - camY; fy += 38) ctx.fillRect(x, fy, b.w, 2.5);

          if (b.hasSpotlight && (L.windowGlow > 0.32 || env.wFog > 0.3)) {
            const ang = Math.sin(elapsedTime * 1.1 + b.seed) * 0.42;
            ctx.save(); ctx.translate(x + b.w * 0.5, y); ctx.rotate(ang);
            const sg = ctx.createLinearGradient(0, 0, 0, -260);
            sg.addColorStop(0, `rgba(224, 242, 254, ${(0.20 * Math.max(L.windowGlow, env.wFog)).toFixed(3)})`); sg.addColorStop(1, 'rgba(224, 242, 254, 0)');
            ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-44, -260); ctx.lineTo(44, -260); ctx.lineTo(6, 0); ctx.closePath(); ctx.fill(); ctx.restore();
          }

          if (b.style === 'sapphire_glass' || b.style === 'emerald_tower') {
            ctx.fillStyle = `rgba(224, 242, 254, ${0.10 + L.daylight * 0.22 + env.wetness * 0.10})`;
            ctx.beginPath(); ctx.moveTo(x, y + 85); ctx.lineTo(x + b.w, y + 12); ctx.lineTo(x + b.w, y + 66); ctx.lineTo(x, y + 148); ctx.closePath(); ctx.fill();
            ctx.fillStyle = b.accentColor; ctx.globalAlpha = clamp(0.45 + L.windowGlow * 0.55, 0.42, 0.98);
            ctx.fillRect(x + 2, y, 3.5, h); ctx.fillRect(x + b.w - 5.5, y, 3.5, h); ctx.fillRect(x, y, b.w, 3.5); ctx.globalAlpha = 1;
            ctx.fillStyle = b.style === 'emerald_tower' ? 'rgba(16, 185, 129, 0.34)' : 'rgba(56, 189, 248, 0.32)';
            ctx.fillRect(x + 4, y + 122, b.w - 8, 14);
            if (b.hasSkyGarden) {
              ctx.fillStyle = '#15803d'; ctx.beginPath(); ctx.roundRect(x + 8, y - 11, b.w - 16, 11, [6, 6, 0, 0]); ctx.fill();
              ctx.fillStyle = '#22c55e'; ctx.fillRect(x + 14, y - 15, 22, 7); ctx.fillRect(x + b.w - 40, y - 15, 24, 7);
              ctx.fillStyle = '#4ade80'; ctx.fillRect(x + b.w * 0.42, y - 14, 18, 6);
            }
            if (b.hasWindTurbine) {
              // Spinning Eco-Tower Rooftop Wind Turbine!
              const tx = x + b.w - 28, ty = y - 34;
              ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(tx, y - 6); ctx.lineTo(tx, ty); ctx.stroke();
              const rot = elapsedTime * 4.5 + b.seed;
              for (let bl = 0; bl < 3; bl++) {
                const a = rot + (bl / 3) * Math.PI * 2;
                ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(a) * 14, ty + Math.sin(a) * 14); ctx.stroke();
              }
            }
            if (b.hasHelipad) {
              ctx.fillStyle = '#1e293b'; ctx.fillRect(x + 18, y - 14, b.w - 36, 14);
              ctx.fillStyle = '#38bdf8'; ctx.fillRect(x + 24, y - 9, b.w - 48, 5);
            }
          } else if (b.style === 'artdeco_gold') {
            ctx.fillStyle = rgbStr(lerpRgb(facadeRgb, [255, 248, 220], 0.25)); ctx.fillRect(x + 7, y, 6, h); ctx.fillRect(x + b.w - 13, y, 6, h);
            ctx.fillStyle = rgbStr(facadeRgb); ctx.fillRect(x + 14, y - 22, b.w - 28, 22);
            ctx.fillStyle = '#f59e0b'; ctx.fillRect(x + 14, y - 22, b.w - 28, 4); ctx.fillRect(x, y - 3, b.w, 3);
          } else if (b.style === 'soho_brick') {
            ctx.fillStyle = 'rgba(186, 230, 253, 0.42)'; ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2;
            ctx.fillRect(x + 12, y - 22, b.w * 0.44, 22); ctx.strokeRect(x + 12, y - 22, b.w * 0.44, 22);
            ctx.fillStyle = '#fef3c7'; ctx.globalAlpha = 0.28 + L.daylight * 0.35; ctx.fillRect(x - 4, y - 6, b.w + 8, 7); ctx.globalAlpha = 1;
            if (b.hasAwning) {
              const awX = x + 12, awY = y - 8, awW = b.w * 0.44;
              for (let s = 0; s < 6; s++) { ctx.fillStyle = s % 2 === 0 ? '#dc2626' : '#fef3c7'; ctx.fillRect(awX + s * (awW / 6), awY, awW / 6, 5); }
            }
            if (L.windowGlow > 0.35) {
              for (let l = 0; l < 6; l++) { ctx.fillStyle = l % 2 === 0 ? '#fde047' : '#fb923c'; ctx.beginPath(); ctx.arc(x + 16 + l * 14, y - 24 + Math.sin(l) * 2, 2, 0, Math.PI * 2); ctx.fill(); }
            }
          }

          if (b.hasHVAC) {
            const hx = x + 16, hy = y - 13;
            ctx.fillStyle = '#334155'; ctx.fillRect(hx, hy, 26, 13);
            ctx.fillStyle = '#1e293b'; ctx.fillRect(hx + 4, hy + 3, 18, 7);
            ctx.fillStyle = '#475569'; ctx.fillRect(hx + 30, hy + 4, 16, 9);
          }
          if (b.hasCrane) {
            const cx = x + b.w * 0.5;
            ctx.strokeStyle = '#eab308'; ctx.lineWidth = 2.6;
            ctx.beginPath();
            ctx.moveTo(cx - 4, y); ctx.lineTo(cx - 4, y - 64); ctx.moveTo(cx + 4, y); ctx.lineTo(cx + 4, y - 64);
            ctx.moveTo(cx - 24, y - 62); ctx.lineTo(cx + 62, y - 62); ctx.moveTo(cx, y - 74); ctx.lineTo(cx + 58, y - 62); ctx.moveTo(cx, y - 74); ctx.lineTo(cx - 22, y - 62);
            ctx.stroke();
            ctx.fillStyle = '#1e293b'; ctx.fillRect(cx - 24, y - 62, 12, 8);
          }
          if (b.hasFlag) {
            const fx = x + b.w - 18;
            ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(fx, y); ctx.lineTo(fx, y - 34); ctx.stroke();
            const wave = Math.sin(elapsedTime * 7 + b.seed) * 3;
            ctx.fillStyle = '#e11d48'; ctx.beginPath(); ctx.moveTo(fx, y - 34); ctx.lineTo(fx + 16, y - 31 + wave); ctx.lineTo(fx, y - 24); ctx.closePath(); ctx.fill();
          }

          ctx.fillStyle = rgbStr(L.rim, 0.28); ctx.fillRect(x, y, b.w, 3); ctx.fillRect(x + b.w - 3, y, 3, h);

          if (env.snowAccum > 0.03) {
            const sH = 4 + env.snowAccum * 9;
            ctx.fillStyle = `rgba(248, 250, 252, ${clamp(env.snowAccum * 0.98, 0, 0.98)})`;
            ctx.beginPath(); ctx.roundRect(x - 13, y - sH + 2, b.w + 16, sH, [7, 7, 3, 3]); ctx.fill();
            ctx.fillStyle = `rgba(186, 230, 253, ${(env.snowAccum * 0.45).toFixed(2)})`; ctx.fillRect(x - 11, y + 1, b.w + 13, 2.5);
          }

          if (b.hasSpire) {
            ctx.fillStyle = rgbStr(facadeRgb);
            ctx.beginPath(); ctx.moveTo(x + b.w * 0.38, y - 5); ctx.lineTo(x + b.w * 0.5, y - b.spireH); ctx.lineTo(x + b.w * 0.62, y - 5); ctx.closePath(); ctx.fill();
            if (Math.sin(elapsedTime * 4 + b.seed) > 0) { ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(x + b.w * 0.5, y - b.spireH, 3.8, 0, Math.PI * 2); ctx.fill(); }
          } else if (b.hasWaterTower) {
            const wx = x + b.w * 0.64, wy = y - 5;
            ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(wx + 4, wy); ctx.lineTo(wx + 8, wy - 14); ctx.moveTo(wx + 24, wy); ctx.lineTo(wx + 20, wy - 14); ctx.moveTo(wx + 14, wy); ctx.lineTo(wx + 14, wy - 14); ctx.stroke();
            ctx.fillStyle = '#92400e'; ctx.fillRect(wx + 3, wy - 35, 22, 21);
            ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.moveTo(wx + 1, wy - 35); ctx.lineTo(wx + 14, wy - 45); ctx.lineTo(wx + 27, wy - 35); ctx.closePath(); ctx.fill();
            if (env.snowAccum > 0.08) { ctx.fillStyle = `rgba(255, 255, 255, ${clamp(env.snowAccum * 0.96, 0, 0.96)})`; ctx.beginPath(); ctx.moveTo(wx, wy - 35); ctx.lineTo(wx + 14, wy - 47); ctx.lineTo(wx + 28, wy - 35); ctx.closePath(); ctx.fill(); }
          }

          const litThresh = 0.92 - L.windowGlow * 0.48;
          const winUnlit = L.daylight > 0.5 ? 'rgba(224, 242, 254, 0.30)' : 'rgba(255, 255, 255, 0.07)';
          const winWarm = `rgba(254, 240, 138, ${clamp(0.52 + L.windowGlow * 0.48, 0.44, 0.98).toFixed(2)})`;
          const winCool = `rgba(125, 211, 252, ${clamp(0.46 + L.windowGlow * 0.50, 0.38, 0.92).toFixed(2)})`;
          const wW = b.winW, wH = b.winH, wins = b.windows;
          ctx.fillStyle = winUnlit;
          for (let wIdx = 0; wIdx < wins.length; wIdx++) { const win = wins[wIdx]; if (win.litChance <= litThresh) ctx.fillRect(x + win.rx, y + win.ry, wW, wH); }
          ctx.fillStyle = winWarm;
          for (let wIdx = 0; wIdx < wins.length; wIdx++) { const win = wins[wIdx]; if (win.litChance > litThresh && win.warm) ctx.fillRect(x + win.rx, y + win.ry, wW, wH); }
          ctx.fillStyle = winCool;
          for (let wIdx = 0; wIdx < wins.length; wIdx++) { const win = wins[wIdx]; if (win.litChance > litThresh && !win.warm) ctx.fillRect(x + win.rx, y + win.ry, wW, wH); }
          ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
          for (let wIdx = 0; wIdx < wins.length; wIdx++) { const win = wins[wIdx]; if (win.hasBlind && win.litChance > litThresh) ctx.fillRect(x + win.rx, y + win.ry, wW, 4); }
          if (!settings.liteMode) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
            for (let wIdx = 0; wIdx < wins.length; wIdx++) { const win = wins[wIdx]; ctx.fillRect(x + win.rx - 1, y + win.ry + wH, wW + 2, 1.5); }
          }

          const lobbyY = GROUND_Y - 58 - camY;
          if (lobbyY > y + 55) {
            ctx.fillStyle = 'rgba(15, 23, 42, 0.65)'; ctx.fillRect(x + 8, lobbyY, b.w - 16, 44);
            ctx.fillStyle = `rgba(254, 240, 138, ${clamp(0.38 + L.windowGlow * 0.52, 0.38, 0.92)})`;
            const bayW = (b.w - 30) / 3;
            for (let bay = 0; bay < 3; bay++) ctx.fillRect(x + 12 + bay * (bayW + 3), lobbyY + 12, bayW - 2, 28);
            ctx.fillStyle = b.storefrontColor; ctx.fillRect(x + 6, lobbyY + 2, b.w - 12, 8);
          }

          if (b.bladeSign) {
            const bsX = x + b.w + 1, bsY = y + 95;
            ctx.fillStyle = '#0f172a'; ctx.fillRect(bsX, bsY, 15, 48);
            ctx.strokeStyle = b.bladeSign.color; ctx.lineWidth = 1.6; ctx.strokeRect(bsX, bsY, 15, 48);
            ctx.fillStyle = b.bladeSign.color; ctx.font = '900 7.5px system-ui, sans-serif'; ctx.textAlign = 'center';
            for (let ch = 0; ch < b.bladeSign.text.length; ch++) ctx.fillText(b.bladeSign.text[ch], bsX + 7.5, bsY + 10 + ch * 8.5);
          }

          if (b.hasFireEscape) {
            const fx = x + 10, fw = 36;
            ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)'; ctx.lineWidth = 2; ctx.beginPath();
            for (let fy = y + 70; fy < GROUND_Y - 70; fy += 48) { ctx.moveTo(fx, fy); ctx.lineTo(fx + fw, fy); ctx.moveTo(fx, fy - 10); ctx.lineTo(fx + fw, fy - 10); ctx.moveTo(fx + 4, fy); ctx.lineTo(fx + fw - 4, fy + 48); }
            ctx.stroke();
          }

          if (b.brand) {
            const sx = x + 12, sy = y + 12, sw = b.w - 24, sh = 26;
            if (L.windowGlow > 0.35 || env.wFog > 0.3) {
              ctx.fillStyle = b.brand.glow; ctx.globalAlpha = clamp(0.18 + L.windowGlow * 0.16 + env.wFog * 0.22, 0, 0.45);
              ctx.beginPath(); ctx.roundRect(sx - 8, sy - 6, sw + 16, sh + 12, 10); ctx.fill(); ctx.globalAlpha = 1;
            }
            ctx.fillStyle = '#090d16'; ctx.beginPath(); ctx.roundRect(sx - 2, sy - 2, sw + 4, sh + 4, 5); ctx.fill();
            ctx.fillStyle = b.brand.bg; ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 4); ctx.fill();
            const scanX = ((elapsedTime * 55 + b.seed) % (sw + 30)) - 15, clX = clamp(sx + scanX, sx, sx + sw);
            ctx.fillStyle = 'rgba(255,255,255,0.26)'; ctx.fillRect(clX, sy, Math.min(12, sx + sw - clX), sh);
            ctx.fillStyle = b.brand.fg; ctx.font = '900 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(b.brand.text, sx + sw * 0.5, sy + 10, sw - 8);
            ctx.font = '700 7px system-ui, sans-serif'; ctx.globalAlpha = 0.88; ctx.fillText(b.brand.sub, sx + sw * 0.5, sy + 20, sw - 8); ctx.globalAlpha = 1;
            if (env.snowAccum > 0.15) { ctx.fillStyle = `rgba(248, 250, 252, ${env.snowAccum * 0.92})`; ctx.fillRect(sx - 1, sy - 3, sw + 2, 3.5 * env.snowAccum); }
          }
        }

        for (let i = 0; i < roofPigeons.length; i++) {
          const pg = roofPigeons[i], px = pg.x - camX, py = pg.y - camY;
          if (px < -30 || px > viewW + 30) continue;
          ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.8;
          if (pg.flying) { const flap = Math.sin(pg.wing) * 4.5; ctx.beginPath(); ctx.moveTo(px - 6, py + flap); ctx.lineTo(px, py); ctx.lineTo(px + 6, py + flap); ctx.stroke(); }
          else { ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI * 2); ctx.fill(); }
        }
        for (let i = 0; i < steamPuffs.length; i++) {
          const sp = steamPuffs[i]; ctx.fillStyle = `rgba(241, 245, 249, ${(sp.life * 0.24).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(sp.x - camX, sp.y - camY, sp.r, 0, Math.PI * 2); ctx.fill();
        }
      }

      function drawStreetAndTransit(L) {
        const roadY = GROUND_Y - camY, trackY = roadY - 26;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'; ctx.fillRect(0, trackY, viewW, 7);
        if (env.snowAccum > 0.08) { ctx.fillStyle = `rgba(248, 250, 252, ${env.snowAccum * 0.88})`; ctx.fillRect(0, trackY - 2.5, viewW, 3 * env.snowAccum); }
        const pOff = ((camX * 0.85) % 140 + 140) % 140;
        for (let px = -pOff; px < viewW + 140; px += 140) ctx.fillRect(px, trackY + 6, 7, 24);

        const tx = subwayTrain.x;
        if (tx > -420 && tx < viewW + 100) {
          for (let car = 0; car < 4; car++) {
            const cx = tx + car * 78;
            ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.roundRect(cx, trackY - 18, 72, 18, [4, 4, 1, 1]); ctx.fill();
            ctx.fillStyle = '#2563eb'; ctx.fillRect(cx, trackY - 6, 72, 3.5);
            ctx.fillStyle = L.windowGlow > 0.25 ? '#fef08a' : '#f8fafc';
            for (let w = 0; w < 5; w++) ctx.fillRect(cx + 6 + w * 13, trackY - 14, 9, 6);
            if (env.snowAccum > 0.15) { ctx.fillStyle = `rgba(255, 255, 255, ${env.snowAccum * 0.9})`; ctx.fillRect(cx + 2, trackY - 20, 68, 3 * env.snowAccum); }
          }
        }

        // Cycling NYC Traffic Lights along the avenue!
        const tlStep = 280, tlOff = ((camX * 1.0) % tlStep + tlStep) % tlStep;
        const tlPhase = Math.floor(elapsedTime * 0.45) % 3;
        for (let lx = -tlOff; lx < viewW + tlStep; lx += tlStep) {
          ctx.fillStyle = '#334155'; ctx.fillRect(lx, roadY - 22, 3, 22);
          ctx.fillStyle = '#f59e0b'; ctx.fillRect(lx - 2, roadY - 26, 7, 13);
          ctx.fillStyle = tlPhase === 0 ? '#ef4444' : tlPhase === 1 ? '#fde047' : '#22c55e';
          ctx.beginPath(); ctx.arc(lx + 1.5, roadY - 23 + tlPhase * 3.5, 1.8, 0, Math.PI * 2); ctx.fill();
        }

        const hazeY = roadY - 65;
        const hGrad = ctx.createLinearGradient(0, hazeY, 0, WORLD_H);
        hGrad.addColorStop(0, 'rgba(0,0,0,0)'); hGrad.addColorStop(0.7, rgbStr(L.skyBot, 0.22 + env.wFog * 0.30)); hGrad.addColorStop(1, env.snowAccum > 0.35 ? '#cbd5e1' : '#090d16');
        ctx.fillStyle = hGrad; ctx.fillRect(0, hazeY, viewW, WORLD_H - hazeY + 40);

        if (state === 'playing' && gameMode === 'arcade' && player.y > GROUND_Y - 160) {
          ctx.fillStyle = `rgba(239, 68, 68, ${(clamp((player.y - (GROUND_Y - 160)) / 145, 0, 1) * 0.36).toFixed(3)})`;
          ctx.fillRect(0, roadY - 38, viewW, 90);
        }

        let roadCol = lerpRgb([16, 22, 34], [12, 22, 42], env.wetness);
        roadCol = lerpRgb(roadCol, [232, 240, 248], env.snowAccum * 0.92);
        ctx.fillStyle = rgbStr(roadCol); ctx.fillRect(0, roadY, viewW, 120);

        if (env.snowAccum > 0.05) {
          ctx.fillStyle = `rgba(255, 255, 255, ${clamp(env.snowAccum * 0.98, 0, 0.98)})`; ctx.fillRect(0, roadY - 2, viewW, 5 + env.snowAccum * 4);
          ctx.fillStyle = `rgba(71, 85, 105, ${(env.snowAccum * 0.34).toFixed(2)})`; ctx.fillRect(0, roadY + 14, viewW, 4); ctx.fillRect(0, roadY + 28, viewW, 4);
        } else {
          ctx.fillStyle = 'rgba(250, 204, 21, 0.55)';
          const dOff = ((camX * 1.0) % 52 + 52) % 52;
          for (let dx = -dOff; dx < viewW + 52; dx += 52) ctx.fillRect(dx, roadY + 21, 24, 2.5);
        }

        if (env.wetness > 0.12) {
          ctx.save(); ctx.globalAlpha = env.wetness * 0.30;
          for (let i = 0; i < buildings.length; i++) {
            const b = buildings[i]; if (!b.brand) continue;
            const rx = b.x - camX + 12; if (rx > viewW + 40 || rx + b.w < -40) continue;
            ctx.fillStyle = b.brand.glow; ctx.fillRect(rx, roadY + 4, b.w - 24, 34);
          }
          ctx.restore();
        }

        // Classic NYC Street Manhole Steam Rising!
        for (let i = 0; i < streetSteam.length; i++) {
          const sp = streetSteam[i];
          ctx.fillStyle = `rgba(241, 245, 249, ${(sp.life * 0.22).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(sp.x - camX, sp.y - camY, sp.r, 0, Math.PI * 2); ctx.fill();
        }

        // Yellow Taxis, Traffic & Flashing NYPD Police Cruiser!
        for (let i = 0; i < taxis.length; i++) {
          const car = taxis[i], cy = roadY + 9 + car.lane * 14, dir = car.speed > 0 ? 1 : -1;
          if (car.kind === 'nypd') {
            ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.roundRect(car.x, cy, 28, 9, 3); ctx.fill();
            ctx.fillStyle = '#2563eb'; ctx.fillRect(car.x + 2, cy + 4, 24, 3);
            ctx.fillStyle = '#0f172a'; ctx.fillRect(car.x + 6, cy - 4, 14, 5);
            // Flashing Red-Blue Siren Lightbar!
            const sirenCol = Math.floor(elapsedTime * 12) % 2 === 0 ? '#ef4444' : '#3b82f6';
            ctx.fillStyle = sirenCol; ctx.fillRect(car.x + 11, cy - 6.5, 5, 2.5);
            ctx.fillStyle = sirenCol === '#ef4444' ? 'rgba(239,68,68,0.28)' : 'rgba(59,130,246,0.28)';
            ctx.beginPath(); ctx.arc(car.x + 13, cy - 5, 13, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.fillStyle = car.kind === 'taxi' ? '#facc15' : car.color; ctx.beginPath(); ctx.roundRect(car.x, cy, 26, 9, 3); ctx.fill();
            ctx.fillStyle = car.kind === 'taxi' ? '#eab308' : '#1e293b'; ctx.fillRect(car.x + 6, cy - 4, 13, 5);
            if (env.snowAccum > 0.25) { ctx.fillStyle = `rgba(255, 255, 255, ${env.snowAccum * 0.92})`; ctx.fillRect(car.x + 6, cy - 5.5, 13, 2.2); }
          }
          const hx = dir > 0 ? car.x + 25 : car.x - 2;
          ctx.fillStyle = '#fef08a'; ctx.fillRect(hx, cy + 2, 4, 4);
          if (L.windowGlow > 0.35 || env.wFog > 0.3) {
            ctx.fillStyle = `rgba(254, 240, 138, ${clamp(0.18 + env.wFog * 0.22, 0.15, 0.42)})`;
            ctx.beginPath(); ctx.moveTo(hx + 2, cy + 4); ctx.lineTo(hx + dir * 48, cy - 6); ctx.lineTo(hx + dir * 48, cy + 12); ctx.closePath(); ctx.fill();
          }
          ctx.fillStyle = '#ef4444'; ctx.fillRect(dir > 0 ? car.x - 2 : car.x + 24, cy + 2, 3, 4);
          if (env.wetness > 0.2) { ctx.fillStyle = `rgba(250, 204, 21, ${(env.wetness * 0.35).toFixed(2)})`; ctx.fillRect(car.x - 4, cy + 10, 32, 3); }
        }
      }

      function drawHeroCameos() {
        for (let i = 0; i < heroCameos.length; i++) {
          const h = heroCameos[i], hx = h.x - camX, hy = h.y - camY;
          if (hx < -140 || hx > viewW + 140) continue;
          ctx.save(); ctx.translate(hx, hy);
          if (!h.interacted) {
            const auraX = h.type === 'strange' ? 36 : 0;
            ctx.strokeStyle = h.color; ctx.globalAlpha = 0.4 + Math.sin(elapsedTime * 7) * 0.2; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(auraX, 0, 34, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
          }
          const dir = h.vx < 0 ? -1 : 1;
          if (h.type === 'ironman') {
            ctx.save(); ctx.scale(dir, 1);
            ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.moveTo(-18, 2); ctx.lineTo(-42 - Math.random() * 14, 0); ctx.lineTo(-18, 8); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#dc2626'; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.roundRect(-18, -6, 32, 12, 5); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#facc15'; ctx.fillRect(8, -5, 10, 10);
            ctx.fillStyle = '#38bdf8'; ctx.beginPath(); ctx.arc(2, 0, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          } else if (h.type === 'strange') {
            ctx.save(); ctx.translate(36, 0);
            ctx.strokeStyle = 'rgba(249, 115, 22, 0.34)'; ctx.lineWidth = 11;
            ctx.beginPath(); ctx.ellipse(0, 0, 22, 40, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#fb923c'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.ellipse(0, 0, 22, 40, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, 17, 34, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
            ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(-8, -12); ctx.lineTo(-24, 18); ctx.lineTo(8, 16); ctx.lineTo(8, -10); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#1e3a8a'; ctx.fillRect(-6, -10, 12, 22);
            ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(0, -16, 6.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#22c55e'; ctx.beginPath(); ctx.arc(0, -4, 3, 0, Math.PI * 2); ctx.fill();
          } else if (h.type === 'torch') {
            ctx.drawImage(GLOW_SPRITES.orange, -28, -28, 56, 56);
            ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.roundRect(-14, -6, 26, 12, 6); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(12, 0, 6, 0, Math.PI * 2); ctx.fill();
          } else if (h.type === 'thor') {
            ctx.save(); ctx.scale(dir, 1);
            ctx.fillStyle = '#dc2626'; ctx.beginPath(); ctx.moveTo(-4, -5); ctx.lineTo(-34, -2 + Math.sin(elapsedTime * 18) * 4); ctx.lineTo(-28, 10); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#1e293b'; ctx.fillRect(-10, -6, 22, 12);
            ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(12, -2, 6.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#94a3b8'; ctx.fillRect(22, -8, 11, 8);
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(27, -8); ctx.lineTo(35, -18); ctx.lineTo(40, -10); ctx.stroke();
            ctx.restore();
          } else {
            ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#ec4899'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -8, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#18181b'; ctx.fillRect(-5, 0, 10, 14);
            ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(55, -140); ctx.stroke();
          }

          if (state !== 'photo') {
            ctx.font = '800 10px system-ui, sans-serif';
            const text = `${h.name}: "${h.quote}"`, tw = ctx.measureText(text).width + 16;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.roundRect(-tw * 0.5, -48, tw, 20, 10); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#0f172a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, -38);
          }
          ctx.restore();
        }
      }

      function drawWeatherAndWindForeground(L) {
        drawFogLayer(1, L);
        if (env.wRain > 0.02) {
          ctx.save(); ctx.lineCap = 'round';
          const col = L.daylight > 0.45 ? '219, 234, 254' : '186, 230, 253';
          const rainLimit = settings.liteMode ? Math.floor(rainDrops.length * 0.5) : rainDrops.length;
          ctx.strokeStyle = `rgba(${col}, ${(0.42 * env.wRain).toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let i = 0; i < rainLimit; i++) {
            const r = rainDrops[i];
            ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.vx * 0.026, r.y + r.len);
          }
          ctx.stroke();
          if (rainSplashes.length > 0) {
            ctx.strokeStyle = `rgba(224, 242, 254, ${(0.55 * env.wRain).toFixed(3)})`; ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (let i = 0; i < rainSplashes.length; i++) {
              const sp = rainSplashes[i];
              ctx.moveTo(sp.x + sp.r, sp.y);
              ctx.ellipse(sp.x, sp.y, sp.r, sp.r * 0.35, 0, 0, Math.PI * 2);
            }
            ctx.stroke();
          }
          ctx.restore();
        }
        if (env.wSnow > 0.02) {
          ctx.save();
          const snowLimit = settings.liteMode ? Math.floor(snowFlakes.length * 0.5) : snowFlakes.length;
          ctx.fillStyle = `rgba(255, 255, 255, ${(0.82 * env.wSnow).toFixed(3)})`;
          ctx.beginPath();
          for (let i = 0; i < snowLimit; i++) {
            const s = snowFlakes[i];
            ctx.moveTo(s.x + s.r, s.y);
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          }
          ctx.fill();
          if (env.snowAccum > 0.25) {
            const frost = ctx.createRadialGradient(viewW * 0.5, WORLD_H * 0.5, WORLD_H * 0.42, viewW * 0.5, WORLD_H * 0.5, viewW * 0.72);
            frost.addColorStop(0, 'rgba(255,255,255,0)'); frost.addColorStop(1, `rgba(224, 242, 254, ${(env.snowAccum * 0.22).toFixed(3)})`);
            ctx.fillStyle = frost; ctx.fillRect(0, 0, viewW, WORLD_H);
          }
          ctx.restore();
        }
        if (settings.windFx && windRibbons.length > 0) {
          ctx.save(); ctx.lineCap = 'round';
          for (let i = 0; i < windRibbons.length; i++) {
            const wr = windRibbons[i]; if (wr.pts.length < 2) continue;
            ctx.strokeStyle = `rgba(240, 249, 255, ${(clamp(wr.life / wr.maxLife, 0, 1) * 0.55).toFixed(3)})`; ctx.lineWidth = wr.width;
            ctx.beginPath(); ctx.moveTo(wr.pts[0].x - camX, wr.pts[0].y - camY);
            for (let j = 1; j < wr.pts.length; j++) ctx.lineTo(wr.pts[j].x - camX, wr.pts[j].y - camY);
            ctx.stroke();
          }
          ctx.restore();
        }
        if (shockwaves.length > 0) {
          ctx.save();
          for (let i = 0; i < shockwaves.length; i++) {
            const sw = shockwaves[i]; ctx.strokeStyle = sw.color; ctx.globalAlpha = clamp(sw.alpha, 0, 1); ctx.lineWidth = 3.2;
            ctx.beginPath(); ctx.ellipse(sw.x - camX, sw.y - camY, sw.r * 0.55, sw.r, 0, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.restore();
        }
        if (settings.windFx && windStreaks.length > 0) {
          ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
          for (let i = 0; i < windStreaks.length; i++) {
            const ws = windStreaks[i]; ctx.globalAlpha = ws.alpha; ctx.lineWidth = ws.width;
            ctx.beginPath(); ctx.moveTo(ws.x, ws.y); ctx.lineTo(ws.x + ws.len, ws.y); ctx.stroke();
          }
          ctx.restore();
        }
        if (state === 'playing' && (keys.focus || focusHoldActive || impactSlowMo > 0)) {
          const vg = ctx.createRadialGradient(viewW * 0.5, WORLD_H * 0.5, WORLD_H * 0.30, viewW * 0.5, WORLD_H * 0.5, viewW * 0.65);
          vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(14, 165, 233, 0.24)');
          ctx.fillStyle = vg; ctx.fillRect(0, 0, viewW, WORLD_H);
        }
      }

      function drawEntities() {
        for (let i = 0; i < tokens.length; i++) {
          const tk = tokens[i]; if (tk.collected) continue;
          const x = tk.x - camX, y = tk.y - camY + Math.sin(elapsedTime * 4 + tk.phase) * 5;
          if (x < -40 || x > viewW + 40) continue;
          const gr = tk.r * 1.9;
          ctx.drawImage(GLOW_SPRITES.gold, x - gr, y - gr, gr * 2, gr * 2);
          ctx.fillStyle = '#e11d48'; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(x, y, tk.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y + 1, 3.5, 0, Math.PI * 2); ctx.arc(x, y - 3.5, 2.2, 0, Math.PI * 2); ctx.fill();
        }

        // Special Aerial Power-Up Orbs!
        for (let i = 0; i < powerups.length; i++) {
          const pw = powerups[i]; if (pw.collected) continue;
          const x = pw.x - camX, y = pw.y - camY + Math.sin(elapsedTime * 5 + pw.phase) * 6;
          if (x < -50 || x > viewW + 50) continue;
          const col = pw.type === 'overcharge' ? '#f43f5e' : pw.type === 'magnet' ? '#facc15' : '#38bdf8';
          const icon = pw.type === 'overcharge' ? '⚡' : pw.type === 'magnet' ? '🧲' : '🛡️';
          ctx.save();
          ctx.fillStyle = col; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, pw.r + 10 + Math.sin(elapsedTime * 8) * 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = '#0f172a'; ctx.strokeStyle = col; ctx.lineWidth = 2.8;
          ctx.beginPath(); ctx.arc(x, y, pw.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(icon, x, y + 1);
          ctx.restore();
        }

        for (let i = 0; i < boostRings.length; i++) {
          const ring = boostRings[i]; if (ring.triggered) continue;
          const x = ring.x - camX, y = ring.y - camY; if (x < -80 || x > viewW + 80) continue;
          ctx.save(); ctx.translate(x, y);
          const pulse = 1 + Math.sin(elapsedTime * 6 + ring.phase) * 0.06; ctx.scale(0.55 * pulse, 1 * pulse);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.30)'; ctx.lineWidth = 14;
          ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, ring.r - 5, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }

        if (gameMode === 'arcade') {
          for (let i = 0; i < drones.length; i++) {
            const d = drones[i]; if (!d.alive) continue;
            const x = d.x - camX, y = d.y - camY; if (x < -60 || x > viewW + 60) continue;
            if (env.wFog > 0.3) { ctx.strokeStyle = `rgba(248, 113, 113, ${(env.wFog * 0.72).toFixed(2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, d.r + 12 + Math.sin(elapsedTime * 8) * 3, 0, Math.PI * 2); ctx.stroke(); }
            const ar = d.r * 2.1;
            ctx.drawImage(GLOW_SPRITES.green, x - ar, y - ar, ar * 2, ar * 2);
            ctx.fillStyle = '#1e293b'; ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x - 6, y, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(x - 7, y - 1, 2.2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - d.r - 6, y - 6); ctx.lineTo(x + d.r + 6, y - 6); ctx.moveTo(x - d.r - 4, y + 7); ctx.lineTo(x + d.r + 4, y + 7); ctx.stroke();
          }

          if (boss) {
            const gx = boss.x - camX, gy = boss.y - camY; ctx.save(); ctx.translate(gx, gy);
            if (boss.kind === 'goblin') {
              ctx.fillStyle = '#334155'; ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(-26, 12); ctx.lineTo(0, 6); ctx.lineTo(26, 12); ctx.lineTo(14, 19); ctx.lineTo(-14, 19); ctx.closePath(); ctx.fill(); ctx.stroke();
              ctx.fillStyle = '#f97316'; ctx.beginPath(); ctx.arc(20, 14, 5 + Math.sin(elapsedTime * 30) * 1.5, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#16a34a'; ctx.beginPath(); ctx.roundRect(-8, -10, 16, 20, 4); ctx.fill();
              ctx.fillStyle = '#7e22ce'; ctx.beginPath(); ctx.moveTo(-7, -10); ctx.lineTo(12, -16); ctx.lineTo(4, -22); ctx.lineTo(-9, -15); ctx.closePath(); ctx.fill();
              ctx.fillStyle = '#fde047'; ctx.fillRect(-7, -14, 4, 3);
            } else {
              // ELECTRO crackling with pure blue electric energy!
              ctx.drawImage(GLOW_SPRITES.cyan, -34, -34, 68, 68);
              ctx.fillStyle = '#0284c7'; ctx.beginPath(); ctx.roundRect(-9, -12, 18, 24, 5); ctx.fill();
              ctx.fillStyle = '#e0f2fe'; ctx.beginPath(); ctx.arc(0, -16, 8, 0, Math.PI * 2); ctx.fill();
              ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
              for (let z = 0; z < 4; z++) { const a = elapsedTime * 10 + z * 1.57; ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(Math.cos(a) * 20, -16 + Math.sin(a) * 20); ctx.stroke(); }
            }
            ctx.restore();
          }

          for (let i = 0; i < bossProjectiles.length; i++) {
            const b = bossProjectiles[i], bx = b.x - camX, by = b.y - camY;
            if (b.kind === 'pumpkin') {
              ctx.drawImage(GLOW_SPRITES.orange, bx - 22, by - 22, 44, 44);
              ctx.fillStyle = '#ea580c'; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
              ctx.fillStyle = '#fef08a'; ctx.fillRect(bx - 5, by - 3, 3, 3); ctx.fillRect(bx + 2, by - 3, 3, 3);
            } else {
              ctx.drawImage(GLOW_SPRITES.cyan, bx - 24, by - 24, 48, 48);
              ctx.fillStyle = '#38bdf8'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
          }
        }
      }

      function drawTargetReticle() {
        if (state !== 'playing' || player.attached) return;
        const nextAnchor = findBestAnchor(pointerActive); if (!nextAnchor) return;
        const ax = nextAnchor.x - camX, ay = nextAnchor.y - camY, pulse = 1 + Math.sin(elapsedTime * 9) * 0.14;
        ctx.save(); ctx.translate(ax, ay); ctx.scale(pulse, pulse);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-9, 0); ctx.moveTo(9, 0); ctx.lineTo(17, 0); ctx.moveTo(0, -17); ctx.lineTo(0, -9); ctx.moveTo(0, 9); ctx.lineTo(0, 17); ctx.stroke();
        ctx.restore();
      }

      function drawWebLine() {
        if (!player.attached || !player.anchor) return;
        const suit = SUITS[currentSuit];
        const px = player.x - camX, py = player.y - camY, ax = player.anchor.x - camX, ay = player.anchor.y - camY;
        const ang = Math.atan2(ay - py, ax - px), hx = px + Math.cos(ang) * 20, hy = py + Math.sin(ang) * 20;

        ctx.save(); ctx.lineCap = 'round';
        if (suit.special === 'laser_web' || suit.special === 'cyber_neon' || suit.special === 'cosmic_stars' || suit.special === 'ghost_flame') {
          ctx.strokeStyle = suit.special === 'laser_web' ? 'rgba(239, 68, 68, 0.48)' : 'rgba(56, 189, 248, 0.48)';
          ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ax, ay); ctx.stroke();
        } else if (suit.special === 'tendrils' || suit.special === 'anti_tendrils') {
          ctx.strokeStyle = suit.special === 'anti_tendrils' ? 'rgba(9, 9, 11, 0.7)' : 'rgba(255, 255, 255, 0.55)';
          ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ax, ay); ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.36)'; ctx.lineWidth = 4.2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ax, ay); ctx.stroke();
        }

        ctx.strokeStyle = suit.webColor;
        ctx.lineWidth = (suit.special === 'tendrils' || suit.special === 'anti_tendrils') ? 3.5 : (suit.special === 'laser_web' || suit.special === 'cyber_neon') ? 2.8 : 2.4;
        ctx.beginPath(); ctx.moveTo(hx, hy);
        if (player.webAnim > 0.02 || suit.special === 'venom_hands') {
          const steps = 14, nx = -Math.sin(ang), ny = Math.cos(ang);
          for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            let wave = player.webAnim > 0.02 ? Math.sin(t * Math.PI * 4 + elapsedTime * 45) * 8 * player.webAnim * Math.sin(t * Math.PI) : 0;
            if (suit.special === 'venom_hands') wave += (Math.random() - 0.5) * 4.5 * Math.sin(t * Math.PI);
            ctx.lineTo(hx + (ax - hx) * t + nx * wave, hy + (ay - hy) * t + ny * wave);
          }
        } else ctx.lineTo(ax, ay);
        ctx.stroke();

        if (suit.special === 'venom_hands') {
          ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hx, hy);
          const nx = -Math.sin(ang), ny = Math.cos(ang);
          for (let i = 1; i < 8; i++) { const t = i / 8, j = (Math.random() - 0.5) * 9; ctx.lineTo(hx + (ax - hx) * t + nx * j, hy + (ay - hy) * t + ny * j); }
          ctx.lineTo(ax, ay); ctx.stroke();
        }
        ctx.fillStyle = suit.webColor; ctx.beginPath(); ctx.arc(ax, ay, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      // ALL 16 SUITS CUSTOM CHARACTER ART!
      function drawSpiderMan() {
        const suit = SUITS[currentSuit];
        const px = player.x - camX, py = player.y - camY;

        if (player.trail.length > 2) {
          ctx.save();
          for (let i = 1; i < player.trail.length; i++) {
            const p0 = player.trail[i - 1], p1 = player.trail[i], ratio = i / player.trail.length;
            ctx.strokeStyle = settings.prismTrail ? `hsla(${(p1.hue + i * 14) % 360}, 92%, 62%, ${(p1.alpha * ratio * 0.8).toFixed(2)})` : suit.trailColor;
            ctx.globalAlpha = settings.prismTrail ? 1 : p1.alpha * ratio * 0.68;
            ctx.lineWidth = 10.5 * ratio; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(p0.x - camX, p0.y - camY); ctx.lineTo(p1.x - camX, p1.y - camY); ctx.stroke();
          }
          ctx.restore();
        }

        if (player.shieldTimer > 0) {
          ctx.save(); ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2.6; ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
          ctx.beginPath(); ctx.arc(px, py, 34 + Math.sin(elapsedTime * 16) * 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        }
        if (player.magnetTimer > 0 || suit.perks.passiveMagnet) {
          ctx.save(); ctx.strokeStyle = suit.perks.passiveMagnet && player.magnetTimer <= 0 ? 'rgba(34, 211, 238, 0.35)' : 'rgba(250, 204, 21, 0.55)';
          ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
          ctx.beginPath(); ctx.arc(px, py, 44 + Math.sin(elapsedTime * 10) * 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }

        if (player.invulnTimer > 0 && Math.floor(elapsedTime * 16) % 2 === 0) return;

        if (player.spiderSense > 0.08 && (state === 'playing' || state === 'photo')) {
          ctx.save(); ctx.translate(px, py - 24);
          ctx.strokeStyle = `rgba(253, 224, 71, ${player.spiderSense * 0.95})`; ctx.lineWidth = 2.4;
          for (let side = -1; side <= 1; side += 2) { ctx.beginPath(); ctx.moveTo(side * 14, -4); ctx.lineTo(side * 22, -10); ctx.lineTo(side * 19, -2); ctx.lineTo(side * 28, -7); ctx.stroke(); }
          ctx.restore();
        }

        ctx.save(); ctx.translate(px, py);
        let webLocalAngle = -Math.PI * 0.45;
        if (player.attached && player.anchor) webLocalAngle = Math.atan2(player.anchor.y - player.y, player.anchor.x - player.x) - player.angle;
        ctx.rotate(player.angle);

        const swinging = player.attached, speedFactor = Math.min(1, Math.hypot(player.vx, player.vy) / 600);
        const legKick = swinging ? Math.sin(elapsedTime * 6) * 0.22 : (player.flipping ? -0.9 : 0.25);
        const bootCol = suit.boots || suit.primary;

        // Special Back Gear per Suit!
        if (suit.special === 'iron_legs' || suit.special === 'gold_sparkle' || suit.special === 'superior_arms') {
          ctx.strokeStyle = suit.special === 'gold_sparkle' ? '#fef08a' : suit.special === 'superior_arms' ? '#dc2626' : '#f59e0b';
          ctx.lineWidth = suit.special === 'superior_arms' ? 3.5 : 3; ctx.lineCap = 'round';
          for (let l = 0; l < 4; l++) {
            const spread = -1.7 + l * 0.62 + Math.sin(elapsedTime * 7 + l) * 0.14;
            const ex = -6 + Math.cos(spread) * 21, ey = -2 + Math.sin(spread) * 21;
            const tx = ex + Math.cos(spread - 0.5) * 17, ty = ey + Math.sin(spread - 0.5) * 17;
            ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
            if (suit.special === 'superior_arms') { ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.arc(tx, ty, 2.3, 0, Math.PI * 2); ctx.fill(); }
          }
        } else if (suit.special === 'laser_web') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.36)'; ctx.beginPath(); ctx.moveTo(-6, -8); ctx.quadraticCurveTo(-24, -4 + Math.sin(elapsedTime * 15) * 4, -34, 8); ctx.lineTo(-10, 6); ctx.closePath(); ctx.fill();
        } else if (suit.special === 'wing_glider') {
          // Future Foundation Translucent Aerodynamic Web-Wings!
          ctx.fillStyle = 'rgba(224, 242, 254, 0.52)'; ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(-24, 4); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(5, -6); ctx.lineTo(22, -4); ctx.lineTo(6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (suit.special === 'noir_coat') {
          ctx.fillStyle = '#18181b'; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(-5, -8); ctx.quadraticCurveTo(-22, 2 + Math.sin(elapsedTime * 12) * 5, -34, 22); ctx.lineTo(-10, 18); ctx.lineTo(-2, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
        } else if (suit.special === 'tendrils' || suit.special === 'anti_tendrils') {
          ctx.strokeStyle = suit.special === 'anti_tendrils' ? '#f8fafc' : '#09090b'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
          for (let t = 0; t < 3; t++) { const wy = -6 + t * 6; ctx.beginPath(); ctx.moveTo(-5, wy); ctx.quadraticCurveTo(-18, wy + Math.sin(elapsedTime * 14 + t * 2) * 8, -30, wy + Math.cos(elapsedTime * 11 + t) * 7); ctx.stroke(); }
        } else if (suit.special === 'cosmic_stars') {
          const cg = ctx.createRadialGradient(0, -2, 6, 0, -2, 30); cg.addColorStop(0, 'rgba(56, 189, 248, 0.45)'); cg.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, -2, 30, 0, Math.PI * 2); ctx.fill();
        }

        const drawLimb = (x1, y1, mx, my, x2, y2, upperCol, lowerCol, w1 = 6.5, w2 = 5.5) => {
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = '#09090b'; ctx.lineWidth = w1 + 2.6; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = upperCol; ctx.lineWidth = w1; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(mx, my); ctx.stroke();
          ctx.strokeStyle = lowerCol; ctx.lineWidth = w2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(x2, y2); ctx.stroke();
        };

        const drawVenomZap = (hx, hy) => {
          ctx.save(); ctx.strokeStyle = '#fde047'; ctx.lineWidth = 1.8;
          for (let z = 0; z < 2; z++) { const a = Math.random() * Math.PI * 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 6, hy + Math.sin(a) * 6); ctx.lineTo(hx + Math.cos(a + 0.6) * 12, hy + Math.sin(a + 0.6) * 12); ctx.stroke(); }
          ctx.fillStyle = 'rgba(56, 189, 248, 0.65)'; ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        };

        if (player.flipping) drawLimb(-2, 8, -10, 14, -4, 21, suit.secondary, bootCol);
        else drawLimb(-3, 8, -12 - speedFactor * 4, 19, -20 + legKick * 10, 29, suit.secondary, bootCol);

        let backHandX = -24, backHandY = 5;
        if (swinging && (keys.up || reelHoldActive)) {
          backHandX = Math.cos(webLocalAngle) * 19; backHandY = Math.sin(webLocalAngle) * 19;
          drawLimb(-3, -6, backHandX * 0.55 - 4, backHandY * 0.55, backHandX, backHandY, suit.secondary, suit.primary, 5.5, 5);
        } else drawLimb(-3, -6, -15, -3, backHandX, backHandY, suit.secondary, suit.primary, 5.5, 5);

        ctx.fillStyle = suit.primary; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-7, -10); ctx.lineTo(8, -10); ctx.lineTo(5, 10); ctx.lineTo(-5, 10); ctx.closePath(); ctx.fill(); ctx.stroke();

        if (suit.special === 'hoodie_vest' || suit.special === 'mohawk') {
          ctx.fillStyle = suit.secondary; ctx.fillRect(-6, -9, 13, 18);
          ctx.fillStyle = suit.accent; ctx.beginPath(); ctx.arc(1, -1, 3.2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = suit.secondary; ctx.fillRect(-5, -2, 3, 10); ctx.fillRect(3, -2, 3, 10);
          ctx.fillStyle = suit.accent; ctx.beginPath(); ctx.arc(1, -2, 2.9, 0, Math.PI * 2); ctx.fill();
        }

        if (suit.special === 'cosmic_stars') { ctx.fillStyle = '#ffffff'; ctx.fillRect(-3, -6, 2, 2); ctx.fillRect(3, 2, 2, 2); ctx.fillRect(-1, 5, 1.8, 1.8); }

        if (player.flipping) drawLimb(3, 8, 12, 11, 5, 20, suit.secondary, bootCol);
        else drawLimb(3, 8, 12, 16, 4 + legKick * 12, 27, suit.secondary, bootCol);

        let frontHandX = 21, frontHandY = -5;
        if (swinging) {
          frontHandX = Math.cos(webLocalAngle) * 23; frontHandY = Math.sin(webLocalAngle) * 23;
          drawLimb(4, -7, Math.cos(webLocalAngle) * 12, Math.sin(webLocalAngle) * 12 - 3, frontHandX, frontHandY, suit.primary, suit.primary, 5.8, 5.2);
        } else if (player.dashTimer > 0) {
          frontHandX = 27; frontHandY = -11;
          drawLimb(4, -7, 16, -10, frontHandX, frontHandY, suit.primary, suit.primary, 5.8, 5.2);
        } else drawLimb(4, -7, 14, -12, frontHandX, frontHandY, suit.primary, suit.primary, 5.8, 5.2);

        if (suit.special === 'venom_hands') { drawVenomZap(frontHandX, frontHandY); drawVenomZap(backHandX, backHandY); }

        if (suit.special === 'hood') {
          ctx.fillStyle = suit.hoodInner; ctx.beginPath(); ctx.arc(0, -17, 10.6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = suit.hood; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(0, -17, 10.5, Math.PI * 0.55, Math.PI * 1.95); ctx.lineTo(-10, -10); ctx.closePath(); ctx.fill(); ctx.stroke();
        }

        // Spirit Spider Blazing Blue Skull Flame Crown!
        if (suit.special === 'ghost_flame') {
          const fg = ctx.createRadialGradient(2, -22, 3, 2, -24, 22);
          fg.addColorStop(0, 'rgba(224, 242, 254, 0.95)'); fg.addColorStop(0.5, 'rgba(56, 189, 248, 0.72)'); fg.addColorStop(1, 'rgba(37, 99, 235, 0)');
          ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(2, -23, 22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath(); ctx.moveTo(-6, -20); ctx.lineTo(-2, -37 + Math.sin(elapsedTime * 28) * 3); ctx.lineTo(3, -29); ctx.lineTo(8, -36 + Math.cos(elapsedTime * 24) * 3); ctx.lineTo(10, -20); ctx.closePath(); ctx.fill();
        }

        ctx.fillStyle = suit.primary; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(2, -17, 8.2, 9.2, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        if (suit.special === 'mohawk') {
          ctx.fillStyle = '#f43f5e'; ctx.strokeStyle = '#09090b'; ctx.lineWidth = 1.3;
          for (let sp = 0; sp < 4; sp++) { const sx = -4 + sp * 3.5; ctx.beginPath(); ctx.moveTo(sx - 2, -24); ctx.lineTo(sx, -34 + sp * 1.2); ctx.lineTo(sx + 2.5, -24); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        }
        if (suit.special === 'noir_coat') {
          ctx.fillStyle = '#09090b'; ctx.fillRect(-10, -24, 24, 3);
          ctx.beginPath(); ctx.roundRect(-6, -32, 16, 9, [4, 4, 0, 0]); ctx.fill();
          ctx.fillStyle = '#52525b'; ctx.fillRect(-6, -26, 16, 2);
        }

        ctx.fillStyle = suit.eyeFill; ctx.strokeStyle = suit.eyeRim; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(4, -19.5); ctx.quadraticCurveTo(10, -21, 9.5, -16); ctx.quadraticCurveTo(6, -14.5, 4, -19.5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }

      function drawParticlesAndPopups() {
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]; ctx.globalAlpha = Math.max(0, p.life / p.maxLife); ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, p.size, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (state === 'photo') return;
        for (let i = 0; i < popups.length; i++) {
          const pop = popups[i], x = pop.x - camX, y = pop.y - camY;
          ctx.save(); ctx.globalAlpha = clamp(pop.life * 1.4, 0, 1);
          ctx.font = `900 italic ${pop.size}px system-ui, -apple-system, sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = 4.5; ctx.strokeStyle = 'rgba(9, 13, 24, 0.9)'; ctx.strokeText(pop.text, x, y);
          ctx.fillStyle = pop.color; ctx.fillText(pop.text, x, y); ctx.restore();
        }
      }

      function render() {
        ctx.save();
        ctx.scale(dpr * baseScale * camZoom, dpr * baseScale * camZoom);
        if (shakeTimer > 0 && state !== 'photo') ctx.translate((Math.random() - 0.5) * shakeMag * 2, (Math.random() - 0.5) * shakeMag * 2);
        const L = frameLighting || getCurrentLighting();
        drawSkyAndAtmosphere(L);
        drawParallaxCities(L);
        drawFogLayer(0, L);
        drawForegroundBuildings(L);
        drawStreetAndTransit(L);
        drawHeroCameos();
        drawEntities();
        drawTargetReticle();
        drawWebLine();
        drawSpiderMan();
        drawWeatherAndWindForeground(L);
        drawParticlesAndPopups();
        ctx.restore();
      }

      // ============================================================
      // MAIN LOOP
      // ============================================================
      let lastTime = performance.now();
      let fpsFrames = 0, fpsLastSample = lastTime, lastFpsText = '';
      function loop(now) {
        const rawDelta = now - lastTime;
        const dt = Math.min(Math.max(rawDelta / 1000, 0), 0.033);
        lastTime = now;
        update(dt);
        render();
        if (settings.showFps) {
          fpsFrames++;
          if (now - fpsLastSample >= 250) {
            const fps = Math.round((fpsFrames * 1000) / Math.max(1, now - fpsLastSample));
            const txt = `${fps} FPS`;
            if (txt !== lastFpsText) { lastFpsText = txt; elFps.textContent = txt; }
            fpsFrames = 0; fpsLastSample = now;
          }
        }
        requestAnimationFrame(loop);
      }

      // ============================================================
      // INPUT LISTENERS & UI BINDINGS
      // ============================================================
      const settingsPanel = document.getElementById('settings-panel');
      const timeDropdown = document.getElementById('time-dropdown');
      const achModal = document.getElementById('overlay-achievements');
      const wardrobeModal = document.getElementById('overlay-wardrobe');

      function closePopovers() { settingsPanel.classList.add('closed'); timeDropdown.classList.add('closed'); }

      document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('#settings-panel') && !e.target.closest('#btn-settings') && !e.target.closest('#btn-start-settings') && !e.target.closest('#time-dropdown') && !e.target.closest('#btn-time-menu')) {
          closePopovers();
        }
      });

      let resumeAfterModal = false;
      function openModal(modalEl, renderFn) {
        closePopovers(); renderFn();
        if (state === 'playing') { resumeAfterModal = true; state = 'paused'; }
        modalEl.classList.remove('hidden'); modalEl.classList.add('flex');
      }
      function closeModals() {
        achModal.classList.add('hidden'); achModal.classList.remove('flex');
        wardrobeModal.classList.add('hidden'); wardrobeModal.classList.remove('flex');
        if (resumeAfterModal) { resumeAfterModal = false; state = 'playing'; }
      }

      function updatePointerWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect(), s = baseScale * camZoom;
        pointerWorldX = (clientX - rect.left) / s + camX; pointerWorldY = (clientY - rect.top) / s + camY; pointerActive = true;
      }

      canvas.addEventListener('pointerdown', (e) => {
        closePopovers();
        if (state !== 'playing') return;
        e.preventDefault(); AudioFX.init();
        if (e.button === 2) { triggerDash(); return; }
        if (activeWebPointerId === null) { activeWebPointerId = e.pointerId; updatePointerWorld(e.clientX, e.clientY); attachWeb(true); }
      });

      canvas.addEventListener('pointermove', (e) => { if (activeWebPointerId === null || e.pointerId === activeWebPointerId) updatePointerWorld(e.clientX, e.clientY); });
      function handlePointerEnd(e) { if (activeWebPointerId !== null && e.pointerId === activeWebPointerId) { activeWebPointerId = null; releaseWeb(); } }
      window.addEventListener('pointerup', handlePointerEnd);
      window.addEventListener('pointercancel', handlePointerEnd);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      const btnReel = document.getElementById('btn-reel');
      btnReel.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); AudioFX.init(); reelHoldActive = true; btnReel.classList.add('bg-sky-500', 'text-white'); });
      const endReel = (e) => { e.stopPropagation(); reelHoldActive = false; btnReel.classList.remove('bg-sky-500', 'text-white'); };
      btnReel.addEventListener('pointerup', endReel); btnReel.addEventListener('pointercancel', endReel); btnReel.addEventListener('pointerleave', endReel);

      const btnFocus = document.getElementById('btn-focus');
      btnFocus.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); AudioFX.init(); focusHoldActive = true; btnFocus.classList.add('bg-amber-400', 'text-slate-950'); });
      const endFocus = (e) => { e.stopPropagation(); focusHoldActive = false; btnFocus.classList.remove('bg-amber-400', 'text-slate-950'); };
      btnFocus.addEventListener('pointerup', endFocus); btnFocus.addEventListener('pointercancel', endFocus); btnFocus.addEventListener('pointerleave', endFocus);

      btnDash.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); AudioFX.init(); triggerDash(); });

      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const code = e.code;
        if (code === 'Space') {
          e.preventDefault(); AudioFX.init();
          if (!achModal.classList.contains('hidden') || !wardrobeModal.classList.contains('hidden')) { closeModals(); return; }
          if (state === 'start' || state === 'gameover') { resetGame(true); return; }
          if (state === 'paused') { togglePause(); return; }
          if (state === 'photo') { togglePhotoMode(); return; }
          keys.space = true; attachWeb(false);
        } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyE') triggerDash();
        else if (code === 'KeyQ') keys.focus = true;
        else if (code === 'KeyC') { if (state === 'playing' || state === 'photo') togglePhotoMode(); }
        else if (code === 'KeyP' || code === 'Escape') {
          if (!achModal.classList.contains('hidden') || !wardrobeModal.classList.contains('hidden')) { closeModals(); return; }
          if (state === 'photo') togglePhotoMode();
          else if (state === 'playing' || state === 'paused') togglePause();
        } else if (code === 'KeyR') resetGame(true);
        else if (code === 'ArrowRight' || code === 'KeyD') keys.right = true;
        else if (code === 'ArrowLeft' || code === 'KeyA') keys.left = true;
        else if (code === 'ArrowUp' || code === 'KeyW') keys.up = true;
        else if (code === 'ArrowDown' || code === 'KeyS') keys.down = true;
      });

      window.addEventListener('keyup', (e) => {
        const code = e.code;
        if (code === 'Space') { keys.space = false; releaseWeb(); }
        else if (code === 'KeyQ') keys.focus = false;
        else if (code === 'ArrowRight' || code === 'KeyD') keys.right = false;
        else if (code === 'ArrowLeft' || code === 'KeyA') keys.left = false;
        else if (code === 'ArrowUp' || code === 'KeyW') keys.up = false;
        else if (code === 'ArrowDown' || code === 'KeyS') keys.down = false;
      });

      document.getElementById('btn-start-play').addEventListener('click', () => { AudioFX.init(); resetGame(true); });
      document.getElementById('btn-retry').addEventListener('click', () => { AudioFX.init(); resetGame(true); });
      document.getElementById('btn-restart').addEventListener('click', () => { AudioFX.init(); resetGame(true); });
      document.getElementById('btn-pause').addEventListener('click', () => togglePause());
      document.getElementById('btn-resume').addEventListener('click', () => togglePause());
      document.getElementById('btn-pause-restart').addEventListener('click', () => { AudioFX.init(); resetGame(true); });
      document.getElementById('btn-photo').addEventListener('click', (e) => { e.stopPropagation(); togglePhotoMode(); });
      document.getElementById('btn-photo-exit').addEventListener('click', () => togglePhotoMode());
      document.getElementById('btn-photo-save').addEventListener('click', () => savePhotoPNG());

      document.getElementById('btn-wardrobe').addEventListener('click', (e) => { e.stopPropagation(); openModal(wardrobeModal, renderWardrobeModal); });
      document.getElementById('btn-start-wardrobe').addEventListener('click', (e) => { e.stopPropagation(); openModal(wardrobeModal, renderWardrobeModal); });
      document.getElementById('btn-go-wardrobe').addEventListener('click', (e) => { e.stopPropagation(); openModal(wardrobeModal, renderWardrobeModal); });
      document.getElementById('btn-open-wardrobe-from-settings').addEventListener('click', (e) => { e.stopPropagation(); openModal(wardrobeModal, renderWardrobeModal); });
      document.getElementById('btn-wardrobe-close').addEventListener('click', closeModals);

      document.getElementById('btn-achievements').addEventListener('click', (e) => { e.stopPropagation(); openModal(achModal, renderAchievementsModal); });
      document.getElementById('btn-ach-close').addEventListener('click', closeModals);

      document.getElementById('btn-time-menu').addEventListener('click', (e) => { e.stopPropagation(); settingsPanel.classList.add('closed'); timeDropdown.classList.toggle('closed'); });
      document.querySelectorAll('.time-opt').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); setTimePreset(btn.dataset.time); timeDropdown.classList.add('closed'); }));
      document.getElementById('btn-time-auto').addEventListener('click', (e) => { e.stopPropagation(); env.autoTime = !env.autoTime; updateTimeMenuUI(); });

      const toggleSettingsPanel = (e) => { e.stopPropagation(); timeDropdown.classList.add('closed'); settingsPanel.classList.toggle('closed'); };
      document.getElementById('btn-settings').addEventListener('click', toggleSettingsPanel);
      const btnStartSettings = document.getElementById('btn-start-settings');
      if (btnStartSettings) btnStartSettings.addEventListener('click', toggleSettingsPanel);
      document.getElementById('btn-weather-cycle').addEventListener('click', () => { AudioFX.init(); setWeather(WEATHER_ORDER[(env.weatherIndex + 1) % WEATHER_ORDER.length], true); updateEnvHud(); });
      document.querySelectorAll('.weather-btn').forEach((btn) => btn.addEventListener('click', () => { AudioFX.init(); setWeather(btn.dataset.weather, true); updateEnvHud(); }));
      document.getElementById('chk-auto-weather').addEventListener('change', (e) => { env.autoWeather = e.target.checked; if (env.autoWeather) env.weatherTimer = WEATHER_DURATION; updateEnvHud(); });

      document.getElementById('sel-physics').addEventListener('change', (e) => { settings.physics = e.target.value; });
      document.getElementById('chk-wind-fx').addEventListener('change', (e) => { settings.windFx = e.target.checked; });
      document.getElementById('chk-shake').addEventListener('change', (e) => { settings.screenShake = e.target.checked; });
      document.getElementById('chk-lite').addEventListener('change', (e) => { settings.liteMode = e.target.checked; resizeCanvas(); });
      document.getElementById('chk-prism').addEventListener('change', (e) => { settings.prismTrail = e.target.checked; });
      const chkFps = document.getElementById('chk-fps');
      if (chkFps) chkFps.addEventListener('change', (e) => {
        settings.showFps = e.target.checked;
        elFps.classList.toggle('hidden', !settings.showFps);
        fpsFrames = 0; fpsLastSample = performance.now();
      });

      function setMode(mode) {
        gameMode = mode;
        document.getElementById('btn-mode-arcade').classList.toggle('active', mode === 'arcade');
        document.getElementById('btn-mode-zen').classList.toggle('active', mode === 'zen');
        if (state === 'gameover') resetGame(true); else updateHud();
      }
      document.getElementById('btn-mode-arcade').addEventListener('click', () => setMode('arcade'));
      document.getElementById('btn-mode-zen').addEventListener('click', () => setMode('zen'));
      document.getElementById('btn-switch-zen').addEventListener('click', () => setMode('zen'));

      document.getElementById('btn-sound').addEventListener('click', () => {
        AudioFX.enabled = !AudioFX.enabled; AudioFX.updateAmbient(env.wRain, player.windFactor);
        document.getElementById('icon-sound-on').classList.toggle('hidden', !AudioFX.enabled);
        document.getElementById('icon-sound-off').classList.toggle('hidden', AudioFX.enabled);
      });

      window.addEventListener('themechange', () => { frameLighting = null; render(); });

      if (bestScore > 0) {
        document.getElementById('start-highscore').classList.remove('hidden');
        document.getElementById('start-highscore-val').textContent = bestScore.toLocaleString('vi-VN');
      }

      initAtmosphere();
      updateTimeMenuUI();
      syncRewardsUI();
      resetGame(false);
      requestAnimationFrame(loop);
    })();
