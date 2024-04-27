const config = require('../config.json')
const mariadb = require('mariadb')

/**
 * @typedef KokoRow
 * @property {number} no
 * @property {number} resto
 * @property {Date} root
 * @property {number} time
 * @property {string} md5chksum
 * @property {string} category
 * @property {number} tim
 * @property {string} fname
 * @property {string} ext
 * @property {number} imgw
 * @property {number} imgh
 * @property {string} imgsize
 * @property {number} tw
 * @property {number} th
 * @property {string} pwd
 * @property {string} now Formatted time and info. Example: '2022/04/21(木)08:00 ID:ADMIN'
 * @property {string} name
 * @property {string} email Likely to be empty instead of null
 * @property {string} sub The thread it's on? Not sure
 * @property {string} com The post content
 * @property {string} host The IP that made the post
 * @property {string} status Not sure what this is. It's empty in one of the rows I tested
 */

/**
 * Koko context
 */
class KokoCtx {
	/**
	 * @type {string}
	 */
	board

	/**
	 * @type {import('mariadb').Pool}
	 */
	dbPool

	/**
	 * Creates a KokoCtx instance
	 * @param {string} board The board name
	 */
	constructor(board) {
		this.board = board
		this.dbPool = mariadb.createPool(config.koko.mariadb)
	}

	/**
	 * Tests the DB connection
	 * @returns {Promise<void>}
	 */
	async testConn() {
		const conn = await this.dbPool.getConnection()
		await conn.query('select 1')
		await conn.release()
	}

	/**
	 * Fetches rows
	 * @param {number} afterNo Fetch posts after this post number (use 0 to start from the beginning)
	 * @param {number} maxRows The maximum number of rows to fetch
	 * @returns {Promise<KokoRow[]>} The rows
	 */
	async fetchRows(afterNo, maxRows) {
		const params = []

		let sql = `select * from \`${config.koko.dbNamePrefix}${this.board}\`.imglog`

		if (afterNo !== null) {
			sql += ' where no > ?'
			params.push(afterNo)
		}

		sql += ' order by no asc limit ?'
		params.push(maxRows)

		const conn = await this.dbPool.getConnection()
		try {
			return await conn.query(sql, params)
		} finally {
			await conn.release()
		}
	}

	/**
	 * Closes the context and all associated connections
	 * @returns {Promise<void>}
	 */
	async close() {
		await this.dbPool.end()
	}
}

/* Export functions and classes */
module.exports.KokoCtx = KokoCtx
