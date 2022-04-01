const base32 = require("./base32")
const crypto = require("crypto")
const url = require("url")
const util = require("util")

/**
 * Digest the one-time passcode options.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} options.counter Counter value
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @return {Buffer} The one-time passcode as a buffer.
 */

exports.digest = digest = (options) => {
	let i

	// unpack options
	let secret = options.secret
	const counter = options.counter
	const encoding = options.encoding || "ascii"
	const algorithm = (options.algorithm || "sha1").toLowerCase()

	// Backwards compatibility - deprecated
	if (options.key != null) {
		console.warn("@levminer/speakeasy - Deprecation Notice - Specifying the secret using `key` is no longer supported. Use `secret` instead.")
		secret = options.key
	}

	// convert secret to buffer
	if (!Buffer.isBuffer(secret)) {
		secret = encoding === "base32" ? Buffer.from(base32.decode(secret)) : Buffer.from(secret, encoding)
	}

	// create an buffer from the counter
	const buf = Buffer.alloc(8)
	let tmp = counter
	for (i = 0; i < 8; i++) {
		// mask 0xff over number to get last 8
		buf[7 - i] = tmp & 0xff

		// shift 8 and get ready to loop over the next batch of 8
		tmp = tmp >> 8
	}

	// init hmac with the key
	const hmac = crypto.createHmac(algorithm, secret)

	// update hmac with the counter
	hmac.update(buf)

	// return the digest
	return hmac.digest()
}

/**
 * Generate a counter-based one-time token. Specify the key and counter, and
 * receive the one-time password for that counter position as a string. You can
 * also specify a token length, as well as the encoding (ASCII, hexadecimal, or
 * base32) and the hashing algorithm to use (SHA1, SHA256, SHA512).
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} options.counter Counter value
 * @param {Buffer} [options.digest] Digest, automatically generated by default
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
 *   number of digits for the one-time passcode.
 * @return {String} The one-time passcode.
 */

exports.hotp = hotpGenerate = (options) => {
	// unpack digits
	// backward compatibility: `length` is also accepted here, but deprecated
	const digits = (options.digits != null ? options.digits : options.length) || 6
	if (options.length != null)
		console.warn(
			"@levminer/speakeasy - Deprecation Notice - Specifying token digits using `length` is no longer supported. Use `digits` instead."
		)

	// digest the options
	const digest = options.digest || exports.digest(options)

	// compute HOTP offset
	const offset = digest[digest.length - 1] & 0xf

	// calculate binary code (RFC4226 5.4)
	let code =
		((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)

	// left-pad code
	code = new Array(digits + 1).join("0") + code.toString(10)

	// return length number off digits
	return code.substr(-digits)
}

// Alias counter() for hotp()
exports.counter = exports.hotp

/**
 * Verify a counter-based one-time token against the secret and return the delta.
 * By default, it verifies the token at the given counter value, with no leeway
 * (no look-ahead or look-behind). A token validated at the current counter value
 * will have a delta of 0.
 *
 * You can specify a window to add more leeway to the verification process.
 * Setting the window param will check for the token at the given counter value
 * as well as `window` tokens ahead (one-sided window). See param for more info.
 *
 * `verifyDelta()` will return the delta between the counter value of the token
 * and the given counter value. For example, if given a counter 5 and a window
 * 10, `verifyDelta()` will look at tokens from 5 to 15, inclusive. If it finds
 * it at counter position 7, it will return `{ delta: 2 }`.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} options.counter Counter value. This should be stored by
 *   the application and must be incremented for each request.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future against the provided
 *   passcode, e.g. if W = 10, and C = 5, this function will check the
 *   passcode against all One Time Passcodes between 5 and 15, inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Object} On success, returns an object with the counter
 *   difference between the client and the server as the `delta` property (i.e.
 *   `{ delta: 0 }`).
 * @method hotp․verifyDelta
 * @global
 */

exports.hotp.verifyDelta = hotpVerifyDelta = (options) => {
	let i

	// shadow options
	options = Object.create(options)

	// unpack options
	let token = String(options.token)
	const digits = parseInt(options.digits, 10) || 6
	const window = parseInt(options.window, 10) || 0
	const counter = parseInt(options.counter, 10) || 0

	// fail if token is not of correct length
	if (token.length !== digits) {
		throw new Error("@levminer/speakeasy - hotpVerifyDelta - Wrong toke length")
	}

	// parse token to integer
	token = parseInt(token, 10)

	// fail if token is NA
	if (isNaN(token)) {
		throw new Error("@levminer/speakeasy - hotpVerifyDelta - Token is not a number")
	}

	// loop from C to C + W inclusive
	for (i = counter; i <= counter + window; ++i) {
		options.counter = i
		// domain-specific constant-time comparison for integer codes
		if (parseInt(exports.hotp(options), 10) === token) {
			// found a matching code, return delta
			return { delta: i - counter }
		}
	}

	// no codes have matched
}

/**
 * Verify a counter-based one-time token against the secret and return true if
 * it verifies. Helper function for `hotp.verifyDelta()`` that returns a boolean
 * instead of an object. For more on how to use a window with this, see
 * {@link hotp.verifyDelta}.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} options.counter Counter value. This should be stored by
 *   the application and must be incremented for each request.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future against the provided
 *   passcode, e.g. if W = 10, and C = 5, this function will check the
 *   passcode against all One Time Passcodes between 5 and 15, inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Boolean} Returns true if the token matches within the given
 *   window, false otherwise.
 * @method hotp․verify
 * @global
 */
exports.hotp.verify = hotpVerify = (options) => {
	return exports.hotp.verifyDelta(options) != null
}

/**
 * Calculate counter value based on given options. A counter value converts a
 * TOTP time into a counter value by finding the number of time steps that have
 * passed since the epoch to the current time.
 *
 * @param {Object} options
 * @param {Integer} [options.time] Time in seconds with which to calculate
 *   counter value. Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time since the UNIX epoch from
 *   which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
 *   Initial time in seconds since the UNIX epoch from which to calculate the
 *   counter value. Defaults to 0 (no offset).
 * @return {Integer} The calculated counter value.
 * @private
 */

exports._counter = _counter = (options) => {
	const step = options.step || 30
	const time = options.time != null ? options.time * 1000 : Date.now()

	// also accepts 'initial_time', but deprecated
	const epoch = (options.epoch != null ? options.epoch * 1000 : options.initial_time * 1000) || 0
	if (options.initial_time != null)
		console.warn(
			"@levminer/speakeasy - Deprecation Notice - Specifying the epoch using `initial_time` is no longer supported. Use `epoch` instead."
		)

	return Math.floor((time - epoch) / step / 1000)
}

/**
 * Generate a time-based one-time token. Specify the key, and receive the
 * one-time password for that time as a string. By default, it uses the current
 * time and a time step of 30 seconds, so there is a new token every 30 seconds.
 * You may override the time step and epoch for custom timing. You can also
 * specify a token length, as well as the encoding (ASCII, hexadecimal, or
 * base32) and the hashing algorithm to use (SHA1, SHA256, SHA512).
 *
 * Under the hood, TOTP calculates the counter value by finding how many time
 * steps have passed since the epoch, and calls HOTP with that counter value.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {Integer} [options.time] Time in seconds with which to calculate
 *   counter value. Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time in seconds since the UNIX
 *   epoch from which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {String} [options.key] (DEPRECATED. Use `secret` instead.)
 *   Shared secret key
 * @param {Integer} [options.initial_time=0] (DEPRECATED. Use `epoch` instead.)
 *   Initial time in seconds since the UNIX epoch from which to calculate the
 *   counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.length=6] (DEPRECATED. Use `digits` instead.) The
 *   number of digits for the one-time passcode.
 * @return {String} The one-time passcode.
 */

exports.totp = totpGenerate = (options) => {
	// shadow options
	options = Object.create(options)

	// calculate default counter value
	if (options.counter == null) options.counter = exports._counter(options)

	// pass to hotp
	return this.hotp(options)
}

// Alias time() for totp()
exports.time = exports.totp

/**
 * Verify a time-based one-time token against the secret and return the delta.
 * By default, it verifies the token at the current time window, with no leeway
 * (no look-ahead or look-behind). A token validated at the current time window
 * will have a delta of 0.
 *
 * You can specify a window to add more leeway to the verification process.
 * Setting the window param will check for the token at the given counter value
 * as well as `window` tokens ahead and `window` tokens behind (two-sided
 * window). See param for more info.
 *
 * `verifyDelta()` will return the delta between the counter value of the token
 * and the given counter value. For example, if given a time at counter 1000 and
 * a window of 5, `verifyDelta()` will look at tokens from 995 to 1005,
 * inclusive. In other words, if the time-step is 30 seconds, it will look at
 * tokens from 2.5 minutes ago to 2.5 minutes in the future, inclusive.
 * If it finds it at counter position 1002, it will return `{ delta: 2 }`.
 * If it finds it at counter position 997, it will return `{ delta: -3 }`.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} [options.time] Time in seconds with which to calculate
 *   counter value. Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time in seconds since the UNIX
 *   epoch from which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future and the past against the
 *   provided passcode, e.g. if W = 5, and C = 1000, this function will check
 *   the passcode against all One Time Passcodes between 995 and 1005,
 *   inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Object} On success, returns an object with the time step
 *   difference between the client and the server as the `delta` property (e.g.
 *   `{ delta: 0 }`).
 * @method totp․verifyDelta
 * @global
 */

exports.totp.verifyDelta = totpVerifyDelta = (options) => {
	// shadow options
	options = Object.create(options)

	// unpack options
	const window = parseInt(options.window, 10) || 0

	// calculate default counter value
	if (options.counter == null) options.counter = exports._counter(options)

	// adjust for two-sided window
	options.counter -= window
	options.window += window

	// pass to hotp.verifyDelta
	const delta = exports.hotp.verifyDelta(options)

	// adjust for two-sided window
	if (delta) {
		delta.delta -= window
	}

	return delta
}

/**
 * Verify a time-based one-time token against the secret and return true if it
 * verifies. Helper function for verifyDelta() that returns a boolean instead of
 * an object. For more on how to use a window with this, see
 * {@link totp.verifyDelta}.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.token Passcode to validate
 * @param {Integer} [options.time] Time in seconds with which to calculate
 *   counter value. Defaults to `Date.now()`.
 * @param {Integer} [options.step=30] Time step in seconds
 * @param {Integer} [options.epoch=0] Initial time in seconds  since the UNIX
 *   epoch from which to calculate the counter value. Defaults to 0 (no offset).
 * @param {Integer} [options.counter] Counter value, calculated by default.
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode.
 * @param {Integer} [options.window=0] The allowable margin for the counter.
 *   The function will check "W" codes in the future and the past against the
 *   provided passcode, e.g. if W = 5, and C = 1000, this function will check
 *   the passcode against all One Time Passcodes between 995 and 1005,
 *   inclusive.
 * @param {String} [options.encoding="ascii"] Key encoding (ascii, hex,
 *   base32, base64).
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @return {Boolean} Returns true if the token matches within the given
 *   window, false otherwise.
 * @method totp․verify
 * @global
 */
exports.totp.verify = totpVerify = (options) => {
	return exports.totp.verifyDelta(options) != null
}

/**
 * @typedef GeneratedSecret
 * @type Object
 * @property {String} ascii ASCII representation of the secret
 * @property {String} hex Hex representation of the secret
 * @property {String} base32 Base32 representation of the secret
 * @property {String} qr_code_ascii URL for the QR code for the ASCII secret.
 * @property {String} qr_code_hex URL for the QR code for the hex secret.
 * @property {String} qr_code_base32 URL for the QR code for the base32 secret.
 * @property {String} google_auth_qr URL for the Google Authenticator otpauth
 *   URL's QR code.
 * @property {String} otpauth_url Google Authenticator-compatible otpauth URL.
 */

/**
 * Generates a random secret with the set A-Z a-z 0-9 and symbols, of any length
 * (default 32). Returns the secret key in ASCII, hexadecimal, and base32 format,
 * along with the URL used for the QR code for Google Authenticator (an otpauth
 * URL). Use a QR code library to generate a QR code based on the Google
 * Authenticator URL to obtain a QR code you can scan into the app.
 *
 * @param {Object} options
 * @param {Integer} [options.length=32] Length of the secret
 * @param {Boolean} [options.symbols=false] Whether to include symbols
 * @param {Boolean} [options.otpauth_url=true] Whether to output a Google
 *   Authenticator-compatible otpauth:// URL (only returns otpauth:// URL, no
 *   QR code)
 * @param {String} [options.name] The name to use with Google Authenticator.
 * @param {String} [options.issuer] The provider or service with which the
 *   secret key is associated.
 * @param {Boolean} [options.qr_codes=false] (DEPRECATED. Do not use to prevent
 *   leaking of secret to a third party. Use your own QR code implementation.)
 *   Output QR code URLs for the token.
 * @param {Boolean} [options.google_auth_qr=false] (DEPRECATED. Do not use to
 *   prevent leaking of secret to a third party. Use your own QR code
 *   implementation.) Output a Google Authenticator otpauth:// QR code URL.
 * @return {Object}
 * @return {GeneratedSecret} The generated secret key.
 */
exports.generateSecret = generateSecret = (options) => {
	// options
	if (!options) options = {}
	const length = options.length || 32
	const name = encodeURIComponent(options.name || "SecretKey")
	const issuer = options.issuer
	const qr_codes = options.qr_codes || false
	const google_auth_qr = options.google_auth_qr || false
	const otpauth_url = options.otpauth_url != null ? options.otpauth_url : true
	let symbols = true

	// turn off symbols only when explicity told to
	if (options.symbols !== undefined && options.symbols === false) {
		symbols = false
	}

	// generate an ascii key
	const key = this.generateSecretASCII(length, symbols)

	// return a SecretKey with ascii, hex, and base32
	const SecretKey = {}
	SecretKey.ascii = key
	SecretKey.hex = Buffer.from(key, "ascii").toString("hex")
	SecretKey.base32 = base32.encode(Buffer.from(key)).toString().replace(/=/g, "")

	// generate some qr codes if requested
	if (qr_codes) {
		console.warn(
			"@levminer/speakeasy - Deprecation Notice - generateSecret() QR codes are deprecated and no longer supported. Please use your own QR code implementation."
		)
		SecretKey.qr_code_ascii = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(SecretKey.ascii)}`
		SecretKey.qr_code_hex = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(SecretKey.hex)}`
		SecretKey.qr_code_base32 = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(SecretKey.base32)}`
	}

	// add in the Google Authenticator-compatible otpauth URL
	if (otpauth_url) {
		SecretKey.otpauth_url = exports.otpauthURL({
			secret: SecretKey.ascii,
			label: name,
			issuer,
		})
	}

	// generate a QR code for use in Google Authenticator if requested
	if (google_auth_qr) {
		console.warn(
			"@levminer/speakeasy - Deprecation Notice - generateSecret() Google Auth QR code is deprecated and no longer supported. Please use your own QR code implementation."
		)
		SecretKey.google_auth_qr = `https://chart.googleapis.com/chart?chs=166x166&chld=L|0&cht=qr&chl=${encodeURIComponent(
			exports.otpauthURL({ secret: SecretKey.base32, label: name })
		)}`
	}

	return SecretKey
}

// Backwards compatibility - generate_key is deprecated
exports.generate_key = util.deprecate((options) => {
	return exports.generateSecret(options)
}, "@levminer/speakeasy - Deprecation Notice - `generate_key()` is depreciated, please use `generateSecret()` instead.")

/**
 * Generates a key of a certain length (default 32) from A-Z, a-z, 0-9, and
 * symbols (if requested).
 *
 * @param  {Integer} [length=32]  The length of the key.
 * @param  {Boolean} [symbols=false] Whether to include symbols in the key.
 * @return {String} The generated key.
 */
exports.generateSecretASCII = generateSecretASCII = (length, symbols) => {
	const bytes = crypto.randomBytes(length || 32)
	let set = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz"
	if (symbols) {
		set += "!@#$%^&*()<>?/[]{},.:;"
	}

	let output = ""
	for (let i = 0, l = bytes.length; i < l; i++) {
		output += set[Math.floor((bytes[i] / 255.0) * (set.length - 1))]
	}
	return output
}

// Backwards compatibility - generate_key_ascii is deprecated
exports.generate_key_ascii = util.deprecate((length, symbols) => {
	return exports.generateSecretASCII(length, symbols)
}, "@levminer/speakeasy - Deprecation Notice - `generate_key_ascii()` is depreciated, please use `generateSecretASCII()` instead.")

/**
 * Generate a Google Authenticator-compatible otpauth:// URL for passing the
 * secret to a mobile device to install the secret.
 *
 * Authenticator considers TOTP codes valid for 30 seconds. Additionally,
 * the app presents 6 digits codes to the user. According to the
 * documentation, the period and number of digits are currently ignored by
 * the app.
 *
 * To generate a suitable QR Code, pass the generated URL to a QR Code
 * generator, such as the `qr-image` module.
 *
 * @param {Object} options
 * @param {String} options.secret Shared secret key
 * @param {String} options.label Used to identify the account with which
 *   the secret key is associated, e.g. the user's email address.
 * @param {String} [options.type="totp"] Either "hotp" or "totp".
 * @param {Integer} [options.counter] The initial counter value, required
 *   for HOTP.
 * @param {String} [options.issuer] The provider or service with which the
 *   secret key is associated.
 * @param {String} [options.algorithm="sha1"] Hash algorithm (sha1, sha256,
 *   sha512).
 * @param {Integer} [options.digits=6] The number of digits for the one-time
 *   passcode. Currently ignored by Google Authenticator.
 * @param {Integer} [options.period=30] The length of time for which a TOTP
 *   code will be valid, in seconds. Currently ignored by Google
 *   Authenticator.
 * @param {String} [options.encoding] Key encoding (ascii, hex, base32,
 *   base64). If the key is not encoded in Base-32, it will be reencoded.
 * @return {String} A URL suitable for use with the Google Authenticator.
 * @throws Error if secret or label is missing, or if hotp is used and a
    counter is missing, if the type is not one of `hotp` or `totp`, if the
    number of digits is non-numeric, or an invalid period is used. Warns if
    the number of digits is not either 6 or 8 (though 6 is the only one
    supported by Google Authenticator), and if the hashihng algorithm is
    not one of the supported SHA1, SHA256, or SHA512.
 * @see https://github.com/google/google-authenticator/wiki/Key-Uri-Format
 */

exports.otpauthURL = otpauthURL = (options) => {
	// unpack options
	let secret = options.secret
	let label = options.label
	const issuer = options.issuer
	const type = (options.type || "totp").toLowerCase()
	const counter = options.counter
	const algorithm = options.algorithm
	const digits = options.digits
	let period = options.period
	const encoding = options.encoding || "ascii"

	// validate type
	switch (type) {
		case "totp":
		case "hotp":
			break
		default:
			throw new Error(`@levminer/speakeasy - otpauthURL - Invalid type \`${type}\`; must be \`hotp\` or \`totp\``)
	}

	// validate required options
	if (!secret) throw new Error("@levminer/speakeasy - otpauthURL - Missing secret")
	if (!label) throw new Error("@levminer/speakeasy - otpauthURL - Missing label")

	// require counter for HOTP
	if (type === "hotp" && (counter === null || typeof counter === "undefined")) {
		throw new Error("@levminer/speakeasy - otpauthURL - Missing counter value for HOTP")
	}

	// convert secret to base32
	if (encoding !== "base32") secret = Buffer.from(secret, encoding)
	if (Buffer.isBuffer(secret)) secret = base32.encode(secret)

	// build query while validating
	const query = { secret }
	if (issuer) {
		query.issuer = issuer
		label = `${issuer}:${label}`
	}

	// validate algorithm
	if (algorithm != null) {
		switch (algorithm.toUpperCase()) {
			case "SHA1":
			case "SHA256":
			case "SHA512":
				break
			default:
				console.warn("@levminer/speakeasy - otpauthURL - Warning - Algorithm generally should be SHA1, SHA256, or SHA512")
		}
		query.algorithm = algorithm.toUpperCase()
	}

	// validate digits
	if (digits != null) {
		if (isNaN(digits)) {
			throw new Error(`@levminer/speakeasy - otpauthURL - Invalid digits \`${digits}\``)
		} else {
			switch (parseInt(digits, 10)) {
				case 6:
				case 8:
					break
				default:
					console.warn("@levminer/speakeasy - otpauthURL - Warning - Digits generally should be either 6 or 8")
			}
		}
		query.digits = digits
	}

	// validate period
	if (period != null) {
		period = parseInt(period, 10)
		if (~~period !== period) {
			throw new Error(`@levminer/speakeasy - otpauthURL - Invalid period \`${period}\``)
		}
		query.period = period
	}

	// return url
	return url.format({
		protocol: "otpauth",
		slashes: true,
		hostname: type,
		pathname: label,
		query,
	})
}
