const readline = require('readline')

const readlineInterface = readline.createInterface({
	input: process.stdin,
	output: process.stdout
})

/**
 * Asks a question with readline
 * @param {string} question
 * @returns {Promise<string>}
 */
function askQuestion(question) {
	return new Promise(res => {
		readlineInterface.question(question, res)
	})
}

/* Export functions */
module.exports.askQuestion = askQuestion