#!/usr/bin/env node
require('../dist/spi.cjs').main().catch(error=>{console.error('sPi: '+error.message);process.exitCode=1})
