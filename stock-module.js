// Stock price module using Yahoo Finance
// Provides stock quotes with caching and rate limiting

const YahooFinance = require('yahoo-finance2').default;

class StockModule {
  constructor(options = {}) {
    this.yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    this.cacheTTL = options.cacheTTL || 60000; // 1 minute default cache
    this.cache = new Map(); // symbol -> { data, timestamp }
    this.requestsPerEval = options.requestsPerEval || 10; // Max 10 stocks per eval
    this.evalRequestCount = 0;
  }

  /**
   * Start a new eval session (reset request counter)
   */
  startEval() {
    this.evalRequestCount = 0;
  }

  /**
   * Check if cache is still valid for a symbol
   */
  getCached(symbol) {
    const cached = this.cache.get(symbol.toUpperCase());
    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTTL) {
      this.cache.delete(symbol.toUpperCase());
      return null;
    }

    return cached.data;
  }

  /**
   * Set cache for a symbol
   */
  setCache(symbol, data) {
    this.cache.set(symbol.toUpperCase(), {
      data,
      timestamp: Date.now()
    });

    // Clean old cache entries (older than 10 minutes)
    const cutoff = Date.now() - 600000;
    for (const [sym, entry] of this.cache.entries()) {
      if (entry.timestamp < cutoff) {
        this.cache.delete(sym);
      }
    }
  }

  /**
   * Check rate limits
   */
  checkLimits() {
    if (this.evalRequestCount >= this.requestsPerEval) {
      throw new Error(`Too many stock requests in this eval (max ${this.requestsPerEval})`);
    }
  }

  /**
   * Get quote for a single stock symbol
   */
  async getQuote(symbol) {
    // Check cache first
    const cached = this.getCached(symbol);
    if (cached) {
      return cached;
    }

    // Check rate limits
    this.checkLimits();
    this.evalRequestCount++;

    try {
      const quote = await this.yahooFinance.quote(symbol);

      const result = {
        symbol: quote.symbol,
        name: quote.shortName || quote.longName,
        price: quote.regularMarketPrice,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        open: quote.regularMarketOpen,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        currency: quote.currency,
        exchange: quote.fullExchangeName
      };

      // Cache the result
      this.setCache(symbol, result);

      return result;
    } catch (error) {
      throw new Error(`Failed to get quote for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Get quotes for multiple symbols
   */
  async getQuotes(symbols) {
    if (!Array.isArray(symbols)) {
      symbols = [symbols];
    }

    // Limit to prevent abuse
    if (symbols.length > this.requestsPerEval) {
      throw new Error(`Too many symbols requested (max ${this.requestsPerEval})`);
    }

    const results = {};
    const uncached = [];

    // Check cache for each symbol
    for (const symbol of symbols) {
      const cached = this.getCached(symbol);
      if (cached) {
        results[symbol.toUpperCase()] = cached;
      } else {
        uncached.push(symbol);
      }
    }

    // Fetch uncached symbols
    if (uncached.length > 0) {
      this.checkLimits();
      this.evalRequestCount += uncached.length;

      try {
        // Yahoo Finance supports batch quotes
        const quotes = await this.yahooFinance.quote(uncached);

        // Handle both single and multiple results
        const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

        for (const quote of quotesArray) {
          const result = {
            symbol: quote.symbol,
            name: quote.shortName || quote.longName,
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange,
            changePercent: quote.regularMarketChangePercent,
            open: quote.regularMarketOpen,
            high: quote.regularMarketDayHigh,
            low: quote.regularMarketDayLow,
            volume: quote.regularMarketVolume,
            marketCap: quote.marketCap,
            currency: quote.currency,
            exchange: quote.fullExchangeName
          };

          results[quote.symbol] = result;
          this.setCache(quote.symbol, result);
        }
      } catch (error) {
        throw new Error(`Failed to get quotes: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Get historical data for sparkline/chart
   */
  async getChart(symbol, period = '1d', interval = '5m') {
    // Check cache
    const cacheKey = `${symbol}_${period}_${interval}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    // Check rate limits
    this.checkLimits();
    this.evalRequestCount++;

    try {
      const result = await this.yahooFinance.chart(symbol, {
        period1: this.getPeriodStart(period),
        interval: interval
      });

      const quotes = result.quotes || [];
      const chart = quotes.map(q => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume
      }));

      const chartData = {
        symbol: result.meta.symbol,
        currency: result.meta.currency,
        timezone: result.meta.timezone,
        quotes: chart
      };

      // Cache the result
      this.setCache(cacheKey, chartData);

      return chartData;
    } catch (error) {
      throw new Error(`Failed to get chart for ${symbol}: ${error.message}`);
    }
  }

  /**
   * Convert period string to timestamp
   */
  getPeriodStart(period) {
    const now = Date.now();
    const periods = {
      '1d': now - 86400000,      // 1 day
      '5d': now - 432000000,     // 5 days
      '1mo': now - 2592000000,   // 30 days
      '3mo': now - 7776000000,   // 90 days
      '1y': now - 31536000000    // 1 year
    };

    return new Date(periods[period] || periods['1d']);
  }
}

module.exports = StockModule;
