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
            console.error(`❌ ${message}`, ...args);
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
            console.log(`🐛 ${message}`, ...args);
        }
    }

    success(message, ...args) {
        if (this.currentLevel >= this.levels.info) {
            console.log(`✅ ${message}`, ...args);
        }
    }
}

// Create a singleton instance
export const logger = new Logger();

// Export the class for testing or other uses
export { Logger };