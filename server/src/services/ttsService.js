import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'

const runCommand = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'ignore' })
  child.once('error', reject)
  child.once('close', (code) => {
    if (code === 0) {
      resolve()
      return
    }
    reject(new Error(`${command} exited with code ${code}`))
  })
})

const mapSpeakingRate = (rate) => {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return 1
  }
  return Math.min(2, Math.max(0.5, rate))
}

const synthesizeOnMac = async ({ text, voice, speed, outputPath }) => {
  const aiffPath = `${outputPath}.aiff`
  const speakingRate = Math.round(mapSpeakingRate(speed) * 200)
  const sayArgs = ['-o', aiffPath, '-r', String(speakingRate)]
  if (voice) {
    sayArgs.push('-v', voice)
  }
  sayArgs.push(text)

  await runCommand('say', sayArgs)

  if (!ffmpegPath) {
    throw new Error('無法取得 ffmpeg 執行檔，請確認已安裝 ffmpeg')
  }

  const ffmpegArgs = [
    '-y',
    '-i',
    aiffPath,
    '-ar',
    '24000',
    '-ac',
    '1',
    outputPath
  ]

  await runCommand(ffmpegPath, ffmpegArgs)
}

export const synthesizeSpeech = async ({
  text,
  languageCode = 'zh-TW',
  voiceName,
  speakingRate = 0.9
}) => {
  if (!text) {
    throw new Error('缺少要轉換的文字內容')
  }

  if (process.platform !== 'darwin') {
    throw new Error('目前僅支援在 macOS 上進行語音合成')
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'ai-companion-tts-'))
  const filePath = join(tmpDir, `${randomUUID()}.wav`)
  const voice = voiceName || process.env.TTS_VOICE || null
  const speed = mapSpeakingRate(speakingRate)

  try {
    await synthesizeOnMac({ text, voice, speed, outputPath: filePath })
    const audioBuffer = await readFile(filePath)
    return {
      audioContent: audioBuffer.toString('base64'),
      contentType: 'audio/wav',
      voice: voice ?? 'system-default',
      languageCode
    }
  } catch (error) {
    throw new Error(`語音合成失敗：${error.message}`)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
