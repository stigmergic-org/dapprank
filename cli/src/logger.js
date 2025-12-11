class Logger {
    constructor(level = 'info') {
        this.levels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3
        };
        this.currentLevel = this.levels[level] || this.levels.info;
    }

    setLevel(level) {
        this.currentLevel = this.levels[level] || this.levels.info;
    }

    error(message, ...args) {
        if (this.currentLevel >= this.levels.error) {
            // If the first arg is an Error object, format it properly
            if (args.length === 1 && args[0] instanceof Error) {
                console.error(`❌ ${message}`);
                this._logError(args[0]);
            } else {
                console.error(`❌ ${message}`, ...args);
            }
        }
    }

    warn(message, ...args) {
        if (this.currentLevel >= this.levels.warn) {
            console.warn(`⚠️  ${message}`, ...args);
        }
    }

    info(message, ...args) {
        if (this.currentLevel >= this.levels.info) {
            console.log(message, ...args);
        }
    }

    debug(message, ...args) {
        if (this.currentLevel >= this.levels.debug) {
            // If the only arg is an Error object, format it properly
            if (args.length === 1 && args[0] instanceof Error) {
                console.log(`🐛 ${message}`);
                this._logError(args[0], true);
            } else {
                console.log(`🐛 ${message}`, ...args);
            }
        }
    }

    success(message, ...args) {
        if (this.currentLevel >= this.levels.info) {
            console.log(`✅ ${message}`, ...args);
        }
    }

    /**
     * Internal method to log Error objects with proper formatting
     * @param {Error} error - The error object to log
     * @param {boolean} includeStack - Whether to include the stack trace
     */
    _logError(error, includeStack = false) {
        if (this.currentLevel >= this.levels.debug) {
            console.log(`🐛 Error name: ${error.name || 'Error'}`);
            console.log(`🐛 Error message: ${error.message}`);
            
            if (error.code) {
                console.log(`🐛 Error code: ${error.code}`);
            }
            
            if (error.cause) {
                const causeMessage = typeof error.cause === 'object' ? 
                    (error.cause.message || error.cause.toString()) : 
                    error.cause.toString();
                console.log(`🐛 Caused by: ${causeMessage}`);
            }
            
            if (includeStack && error.stack) {
                console.log(`🐛 Stack trace:\n${error.stack}`);
            }
        }
    }
}

// Create a singleton instance
export const logger = new Logger();

// Export the class for testing or other uses
export { Logger };