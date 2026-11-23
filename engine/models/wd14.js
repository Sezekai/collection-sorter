'use strict';
// Kept for older code paths: the WD v3 taggers are now one of the specs in tagger.js.
const { Tagger, SPECS, normTag } = require('./tagger');
class WD14 extends Tagger { constructor(opts = {}) { super(SPECS[opts.key || 'eva02-large'] || SPECS['eva02-large'], opts); } }
module.exports = { WD14, normTag };
