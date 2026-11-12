import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BrowserSettings} from '../src/browser-settings.tsx';

test('Chrome preferences render safely before asynchronous connection state arrives',()=>{
 const html=renderToStaticMarkup(createElement(BrowserSettings,{disabled:false,request:async()=>{throw new Error('Initial render must not request data');}}));
 assert.match(html,/Normal Chrome connection/);
 assert.match(html,/Approve one page connection test/);
 assert.doesNotMatch(html,/Extracted:/);
});
