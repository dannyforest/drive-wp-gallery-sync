// src/drive.test.js
const { makeGoogleDriveImageUrl, listSubFolders, listImagesInFolder, downloadDriveFile } = require('./drive');

// ---------- makeGoogleDriveImageUrl ----------
describe('makeGoogleDriveImageUrl', () => {
    it('generates correct Google Drive image URL', () => {
        const fileId = '1a2b3c4d5e6f7g8h9i0j';
        const url = makeGoogleDriveImageUrl(fileId);
        expect(url).toBe('https://drive.google.com/uc?export=view&id=1a2b3c4d5e6f7g8h9i0j');
    });

    it('handles file IDs with special characters', () => {
        const fileId = 'abc-123_XYZ';
        const url = makeGoogleDriveImageUrl(fileId);
        expect(url).toBe('https://drive.google.com/uc?export=view&id=abc-123_XYZ');
    });
});

// ---------- listSubFolders ----------
describe('listSubFolders', () => {
    it('lists and sorts folders alphabetically', async () => {
        const mockDrive = {
            files: {
                list: vi.fn().mockResolvedValue({
                    data: {
                        files: [
                            { id: '3', name: 'Charlie' },
                            { id: '1', name: 'Alice' },
                            { id: '2', name: 'Bob' },
                        ],
                        nextPageToken: null
                    }
                })
            }
        };

        const folders = await listSubFolders(mockDrive, 'parent-folder-id');

        expect(folders).toHaveLength(3);
        expect(folders[0].name).toBe('Alice');
        expect(folders[1].name).toBe('Bob');
        expect(folders[2].name).toBe('Charlie');
    });

    it('handles pagination', async () => {
        const mockDrive = {
            files: {
                list: vi.fn()
                    .mockResolvedValueOnce({
                        data: {
                            files: [{ id: '1', name: 'Folder1' }],
                            nextPageToken: 'token123'
                        }
                    })
                    .mockResolvedValueOnce({
                        data: {
                            files: [{ id: '2', name: 'Folder2' }],
                            nextPageToken: null
                        }
                    })
            }
        };

        const folders = await listSubFolders(mockDrive, 'parent-folder-id');

        expect(folders).toHaveLength(2);
        expect(mockDrive.files.list).toHaveBeenCalledTimes(2);
    });

    it('handles empty results', async () => {
        const mockDrive = {
            files: {
                list: vi.fn().mockResolvedValue({
                    data: { files: [], nextPageToken: null }
                })
            }
        };

        const folders = await listSubFolders(mockDrive, 'parent-folder-id');
        expect(folders).toHaveLength(0);
    });
});

// ---------- listImagesInFolder ----------
describe('listImagesInFolder', () => {
    it('filters only image files', async () => {
        const mockDrive = {
            files: {
                list: vi.fn().mockResolvedValue({
                    data: {
                        files: [
                            { id: '1', name: 'photo.jpg', mimeType: 'image/jpeg' },
                            { id: '2', name: 'doc.pdf', mimeType: 'application/pdf' },
                            { id: '3', name: 'image.png', mimeType: 'image/png' },
                        ],
                        nextPageToken: null
                    }
                })
            }
        };

        const images = await listImagesInFolder(mockDrive, 'folder-id');

        expect(images).toHaveLength(2);
        expect(images[0].name).toBe('photo.jpg');
        expect(images[1].name).toBe('image.png');
    });

    it('handles pagination', async () => {
        const mockDrive = {
            files: {
                list: vi.fn()
                    .mockResolvedValueOnce({
                        data: {
                            files: [{ id: '1', name: 'img1.jpg', mimeType: 'image/jpeg' }],
                            nextPageToken: 'token123'
                        }
                    })
                    .mockResolvedValueOnce({
                        data: {
                            files: [{ id: '2', name: 'img2.jpg', mimeType: 'image/jpeg' }],
                            nextPageToken: null
                        }
                    })
            }
        };

        const images = await listImagesInFolder(mockDrive, 'folder-id');

        expect(images).toHaveLength(2);
        expect(mockDrive.files.list).toHaveBeenCalledTimes(2);
    });
});

// ---------- downloadDriveFile ----------
describe('downloadDriveFile', () => {
    it('downloads file and returns Buffer', async () => {
        const mockData = new Uint8Array([1, 2, 3, 4]);
        const mockDrive = {
            files: {
                get: vi.fn().mockResolvedValue({
                    data: mockData
                })
            }
        };

        const buffer = await downloadDriveFile(mockDrive, 'file-id');

        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(mockDrive.files.get).toHaveBeenCalledWith(
            { fileId: 'file-id', alt: 'media' },
            { responseType: 'arraybuffer' }
        );
    });
});

