// src/utils.test.js
const {
    env,
    parseBool,
    pickOrder,
    stripExt,
    makeUniqueFilename,
    basicAuthHeader,
    makeAnchorId,
} = require('./utils');

// ---------- env ----------
describe('env', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('returns process.env value when set', () => {
        process.env.TEST_VAR = 'from-env';
        expect(env('TEST_VAR', 'fallback')).toBe('from-env');
    });

    it('returns fallback when env var is not set', () => {
        delete process.env.TEST_VAR;
        expect(env('TEST_VAR', 'fallback')).toBe('fallback');
    });

    it('returns fallback when env var is empty string', () => {
        process.env.TEST_VAR = '';
        expect(env('TEST_VAR', 'fallback')).toBe('fallback');
    });
});

// ---------- parseBool ----------
describe('parseBool', () => {
    it('returns true for "true" string', () => {
        expect(parseBool('true')).toBe(true);
    });

    it('returns false for "false" string', () => {
        expect(parseBool('false')).toBe(false);
    });

    it('is case-insensitive', () => {
        expect(parseBool('TRUE')).toBe(true);
        expect(parseBool('False')).toBe(false);
    });

    it('returns default for undefined', () => {
        expect(parseBool(undefined, true)).toBe(true);
        expect(parseBool(undefined, false)).toBe(false);
    });

    it('returns default for null', () => {
        expect(parseBool(null, true)).toBe(true);
    });
});

// ---------- pickOrder ----------
describe('pickOrder', () => {
    const items = [
        { name: 'Charlie', modifiedTime: '2024-01-03' },
        { name: 'Alice', modifiedTime: '2024-01-01' },
        { name: 'Bob', modifiedTime: '2024-01-02' },
    ];

    it('sorts by name ascending', () => {
        const sorted = [...items].sort(pickOrder('name_asc'));
        expect(sorted.map(i => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('sorts by name descending', () => {
        const sorted = [...items].sort(pickOrder('name_desc'));
        expect(sorted.map(i => i.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('sorts by modified time descending', () => {
        const sorted = [...items].sort(pickOrder('modified_desc'));
        expect(sorted.map(i => i.name)).toEqual(['Charlie', 'Bob', 'Alice']);
    });

    it('sorts by modified time ascending', () => {
        const sorted = [...items].sort(pickOrder('modified_asc'));
        expect(sorted.map(i => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('defaults to name_asc for unknown order', () => {
        const sorted = [...items].sort(pickOrder('unknown'));
        expect(sorted.map(i => i.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });
});

// ---------- stripExt ----------
describe('stripExt', () => {
    it('removes file extension', () => {
        expect(stripExt('photo.jpg')).toBe('photo');
    });

    it('removes only last extension', () => {
        expect(stripExt('photo.backup.jpg')).toBe('photo.backup');
    });

    it('handles files without extension', () => {
        expect(stripExt('photo')).toBe('photo');
    });

    it('handles hidden files', () => {
        expect(stripExt('.gitignore')).toBe('');
    });
});

// ---------- makeUniqueFilename ----------
describe('makeUniqueFilename', () => {
    it('creates unique filename by prefixing with folder name', () => {
        const result = makeUniqueFilename('Summer', 'photo.jpg');
        expect(result).toBe('Summer-photo.jpg');
    });

    it('sanitizes folder name with special characters', () => {
        const result = makeUniqueFilename('Summer 2024!', 'photo.jpg');
        expect(result).toBe('Summer-2024-photo.jpg');
    });

    it('handles multiple consecutive special characters', () => {
        const result = makeUniqueFilename('Summer   &&&   2024', 'photo.jpg');
        expect(result).toBe('Summer-2024-photo.jpg');
    });

    it('removes leading and trailing dashes', () => {
        const result = makeUniqueFilename('---Summer---', 'photo.jpg');
        expect(result).toBe('Summer-photo.jpg');
    });

    it('handles folder names with accents and unicode', () => {
        const result = makeUniqueFilename('Été 2024', 'photo.jpg');
        expect(result).toBe('t-2024-photo.jpg');
    });
});

// ---------- basicAuthHeader ----------
describe('basicAuthHeader', () => {
    it('creates valid Basic Auth header', () => {
        const header = basicAuthHeader('user', 'pass');
        expect(header).toBe('Basic ' + Buffer.from('user:pass').toString('base64'));
    });
});

// ---------- makeAnchorId ----------
describe('makeAnchorId', () => {
    it('converts text to lowercase', () => {
        expect(makeAnchorId('Hello World')).toBe('hello-world');
    });

    it('replaces non-alphanumeric with hyphens', () => {
        expect(makeAnchorId('Photo & Video!')).toBe('photo-video');
    });

    it('removes leading and trailing hyphens', () => {
        expect(makeAnchorId('--test--')).toBe('test');
    });

    it('handles accented characters', () => {
        expect(makeAnchorId('Café Résumé')).toBe('caf-r-sum');
    });
});

