const config = require('../config.json')
const mariadb = require('mariadb')
const slugify = require('slugify')
const he = require('he')
const striptags = require('striptags')
const mime = require('mime')
const fs = require('fs')

/**
 * vichan context
 */
class VichanCtx {
	/**
	 * @type {string}
	 */
	board

	/**
	 * Thread ID mappings.
	 * Keys are koko thread IDs, values are the corresponding migrated vichan thread ID.
	 * @type {{ [key: number]: number }}
	 */
	threadMappings

	/**
	 * @type {import('mariadb').Pool}
	 */
	dbPool

	/**
	 * Creates a VichanCtx instance
	 * @param {string} board The board name
	 * @param {{ [key: number]: number }} threadMappings Thread ID mappings
	 */
	constructor(board, threadMappings) {
		this.board = board
		this.threadMappings = threadMappings
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
	 * Inserts rows from koko rows
	 * @param {KokoRow[]} kokoRows The koko rows
	 * @returns {Promise<void>}
	 */
	async insertRowsFromKoko(kokoRows) {
		// Split row insert work on each thread
		/**
		 * @type {KokoRow[][]}
		 */
		const work = [[]]
		for (const row of kokoRows) {
			if (row.resto < 1) {
				// The row is a thread
				work.push([row], [])
			} else {
				work[work.length - 1].push(row)
			}
		}

		for (const batch of work) {
			// Skip empty batches
			if (batch.length < 1)
				continue

			const params = []

			let sql = `
				insert into \`${config.vichan.mariadb.database}\`.\`posts_${this.board}\`
				(thread, subject, email, name, trip, body, body_nomarkup, time, bump, files, num_files, filehash, password, ip, slug, sticky, locked, cycle, sage) values 
			`

			// Generate values for batch rows
			const insertVals = []
			for(const row of batch) {
				const resThread = row.resto > 0 ? (this.threadMappings[row.resto] || null) : null
				const resSubject = (row.sub || '').substring(0, 100) || null
				const resEmail = (row.email.substring(0, 30) || '') || null
				const [tmpName, tmpTrip] = striptags(row.name).split('!')
				const resName = tmpName.trim().substring(0, 35)
				const resTrip = (tmpTrip || '').substring(0, 15) || null

				// Process body
				const resBodyNoMarkup = he.unescape(striptags(row.com.replace(/<br ?\/>/gi, '\n')))
				const resBody = he.escape(resBodyNoMarkup)
					.replace(/^&gt;&gt;&gt;\/(\w+)\/(\d*)/gi, (_, board, post) => {
						if (post)
							return `<a href="/${board}/res/${post}.html#${post}">&gt;&gt;&gt;/${board}/${post}</a>`
						else
							return `<a href="/${board}/index.html">&gt;&gt;&gt;/${board}/</a>`
					})
					.replace(/^&gt;&gt;(\d+)/gi, (_, post) =>
						`<a onclick="highlightReply('${post}', event);" href="/${this.board}/res/${this.threadMappings[row.resto] || post}.html#${post}">&gt;&gt;${post}</a>`)
					.replace(/^&gt;(.*)$/gi, '<span class="quote">&gt;$1</span>')
					.replace(/^&lt;(.*)$/gi, '<span class="rquote">&lt;$1</span>')
					.replace(/\n/g, '<br/>')
					.replace(/(\b(https?|):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig, (_, url) =>
						`<a href="${encodeURI(url)}" target="_blank" rel="nofollow noreferrer">${url}</a>`)

				const resTime = row.time
				const resBump = row.time

				// Use hash for empty file if no hash is available
				const hashOrPlaceholder = row.md5chksum || 'd41d8cd98f00b204e9800998ecf8427e'

				// Check if post has an image
				const files = []
				if (row.fname) {
					// Convert size string to bytes
					let sizeBytes = 0
					const [sizeNum, sizeUnit] = row.imgsize.split(' ')
					if (sizeUnit)
						sizeBytes = parseInt(sizeNum) * ({
							'b': 1,
							'kb': 1024,
							'mb': 1024 * 1024,
							'gb': 1024 * 1024 * 1024
						})[sizeUnit.toLowerCase()]
					else
						sizeBytes = parseInt(sizeNum)

					// Try to fix possible malformed number values
					if (isNaN(sizeBytes) || sizeBytes < 0 || typeof sizeBytes !== 'number')
						sizeBytes = 0

					const ext = (row.ext || '').replace('.', '')
					const name = row.fname + row.ext
					let thumbExt = ext
					// Try exotic thumbnails first
					const thumbExts = ['gif', 'jpg', 'jpeg', 'jfif', 'png']
					for (const thExt of thumbExts) {
						const thumbPath = `${config.vichan.instancePath}/${this.board}/thumb/${row.tim}.${thExt}`
						if (fs.existsSync(thumbPath)) {
							thumbExt = thExt
							break
						}
					}
					const file = {
						name,
						type: mime.getType(ext) || 'application/octet-stream',
						tmp_name: '/tmp/_migrated_from_koko',
						error: 0,
						size: sizeBytes,
						filename: name,
						extension: ext,
						file_id: Number(row.tim),
						file: row.tim + row.ext,
						thumb: `${row.tim}.${thumbExt}`,
						is_an_image: true,
						hash: hashOrPlaceholder,
						thumbwidth: row.tw,
						thumbheight: row.th,
						file_path: `${this.board}/src/${row.tim}${row.ext}`,
						thumb_path: `${this.board}/thumb/${row.tim}.${thumbExt}`,
						width: row.imgw,
						height: row.imgh
					}
					files.push(file)
				}

				const resFiles = files.length > 0 ? JSON.stringify(files) : null
				const resNumFiles = files.length
				const resFileHash = row.fname ? (hashOrPlaceholder) : null
				const resPassword = row.pwd.substring(0, 20)
				const resIp = row.host.substring(0, 39)
				const resSlug = row.sub ? slugify(row.sub).substring(0, 256) : null
				const resSticky = 0
				const resLocked = 0
				const resCycle = 0
				const resSage = 0

				// Add insert values
				insertVals.push([
					resThread,
					resSubject,
					resEmail,
					resName,
					resTrip,
					resBody,
					resBodyNoMarkup,
					resTime,
					resBump,
					resFiles,
					resNumFiles,
					resFileHash,
					resPassword,
					resIp,
					resSlug,
					resSticky,
					resLocked,
					resCycle,
					resSage
				])
			}

			// Append insert values SQL
			sql += ' ' + insertVals.map(vals => {
				params.push(...vals)

				return `(${vals.map(_ => '?').join(', ')})`
			}).join(', ')

			const conn = await this.dbPool.getConnection()
			try {
				await conn.query(sql, params)

				// If this was a single-thread insert, fetch its new ID and add the mapping
				if (batch.length < 2 && batch[0].resto < 1)
					this.threadMappings[batch[0].no] = Number((await conn.query('select last_insert_id() as id'))[0].id)
			} finally {
				await conn.release()
			}
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
module.exports.VichanCtx = VichanCtx
