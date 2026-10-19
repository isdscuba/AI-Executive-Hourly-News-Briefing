'use strict';

const fetchMock = require('jest-fetch-mock');
fetchMock.enableMocks();

// Never let tests touch the live data/ directory (state.json holds dedup history).
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.EXEC_NEWS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-news-test-')) + path.sep + 'data';
process.env.EXEC_NEWS_SENT_LOG = path.join(path.dirname(process.env.EXEC_NEWS_DATA_DIR), 'sent-briefs.jsonl');
