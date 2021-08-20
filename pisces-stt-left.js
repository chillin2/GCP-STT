'use strict';

function main(
	languageCode = 'en-US',
	streamingLimit = 290000,
	PORT = 50045
) {
	const chalk = require('chalk');
	const {Writable} = require('stream');
	const speech = require('@google-cloud/speech');
	var dgram = require('dgram');
	var server = dgram.createSocket('udp4');
	const client = new speech.SpeechClient();
	const config = {
		encoding: "LINEAR16",
		sampleRateHertz: 8000,
		languageCode: languageCode,
		alternativeLanguageCodes: ['ko-KR', 'en-US', 'ja-JP'],
		audioChannelCount: 1,
		enableSeparateRecognitionPerChannel: true,
	};

	const request = {
		config,
		interimResults: true,
	};

	let recognizeStream = null;
	let restartCounter = 0;
	let audioInput = [];
	let lastAudioInput = [];
	let resultEndTime = 0;
	let isFinalEndTime = 0;
	let finalRequestEndTime = 0;
	let newStream = true;
	let bridgingOffset = 0;
	let lastTranscriptWasFinal = false;

	function startStream() {
		audioInput = [];
		recognizeStream = client
			.streamingRecognize(request)
			.on('error', err => {
				if (err.code === 11) {
					restartStream();
				} else {
					console.error('API request error ' + err);
				}
			})
			.on('data', speechCallback);

		setTimeout(restartStream, streamingLimit);
	}

	const speechCallback = stream => {
		// Convert API result end time from seconds + nanoseconds to milliseconds
		resultEndTime =
			stream.results[0].resultEndTime.seconds * 1000 +
			Math.round(stream.results[0].resultEndTime.nanos / 1000000);

		// Calculate correct time based on offset from audio sent twice
		const correctedTime =
			resultEndTime - bridgingOffset + streamingLimit * restartCounter;

		process.stdout.clearLine();
		process.stdout.cursorTo(0);
		let stdoutText = '';
		if (stream.results[0] && stream.results[0].alternatives[0]) {
			stdoutText =
				correctedTime + ': ' + stream.results[0].alternatives[0].transcript;
		}

		if (stream.results[0].isFinal) {
			process.stdout.write(chalk.green(`${stdoutText}\n`));

			isFinalEndTime = resultEndTime;
			lastTranscriptWasFinal = true;
		} else {
			// Make sure transcript does not exceed console character length
			if (stdoutText.length > process.stdout.columns) {
				stdoutText =
					stdoutText.substring(0, process.stdout.columns - 4) + '...';
			}
			process.stdout.write(chalk.red(`${stdoutText}`));

			lastTranscriptWasFinal = false;
		}
	};
	const audioInputStreamTransform = new Writable({
		write(chunk, encoding, next) {
			if (newStream && lastAudioInput.length !== 0) {
				// Approximate math to calculate time of chunks
				const chunkTime = streamingLimit / lastAudioInput.length;
				if (chunkTime !== 0) {
					if (bridgingOffset < 0) {
						bridgingOffset = 0;
					}
					if (bridgingOffset > finalRequestEndTime) {
						bridgingOffset = finalRequestEndTime;
					}
					const chunksFromMS = Math.floor(
						(finalRequestEndTime - bridgingOffset) / chunkTime
					);
					bridgingOffset = Math.floor(
						(lastAudioInput.length - chunksFromMS) * chunkTime
					);

					for (let i = chunksFromMS; i < lastAudioInput.length; i++) {
						recognizeStream.write(lastAudioInput[i]);
					}
				}
				newStream = false;
			}

			audioInput.push(chunk);

			if (recognizeStream) {
				recognizeStream.write(chunk);
			}

			next();
		},

		final() {
			if (recognizeStream) {
				recognizeStream.end();
			}
		},
	});

	function restartStream() {
		if (recognizeStream) {
			recognizeStream.end();
			recognizeStream.removeListener('data', speechCallback);
			recognizeStream = null;
		}
		if (resultEndTime > 0) {
			finalRequestEndTime = isFinalEndTime;
		}
		resultEndTime = 0;

		lastAudioInput = [];
		lastAudioInput = audioInput;

		restartCounter++;

		if (!lastTranscriptWasFinal) {
			process.stdout.write('\n');
		}
		process.stdout.write(
			chalk.yellow(`${streamingLimit * restartCounter}: RESTARTING REQUEST\n`)
		);

		newStream = true;

		startStream();
	}

	// [END speech_transcribe_infinite_streaming]
	server.on('listening', function () {
		var address = server.address();
		console.log('');
		console.log('');
		console.log('Listening on ' + languageCode + " : " + address.port + '  press Ctrl+C to stop.');
		console.log('');
		console.log('End (ms)       Transcript Results/Status');
		console.log('=========================================================');
		startStream();
	});

	server.on('message', function (message, remote) {
		//	console.log(remote.address + ':' + remote.port + 'size : ' + remote.size);
		recognizeStream.write(message);
	});

	server.bind(PORT);
}

process.on('unhandledRejection', err => {
	console.error(err.message);
	process.exitCode = 1;
});

main(...process.argv.slice(2));
