const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
var ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const cron = require("node-cron");
const FormData = require('form-data')

const { videos } = require("./videos");
let processCount = 0;
let videoId = videos[processCount].videoID;
let videoTitle = videos[processCount].title;

let videoTitleModified = `${videoTitle.split(" ")[0]}_${videoTitle
  .split(" ")
  .pop()}`;

let vimeoApiUrl = `https://api.vimeo.com/videos/${videoId}`;
const vimeoAccessToken = "4413f3f767b033df50bb61a33da12aaa";

let outputFilePath = path.join(
  __dirname,
  `./vid/${videoId}.mp4`
);

function divideTime(totalSeconds) {
  const timeToDivide = totalSeconds - 6;

  if (timeToDivide <= 0) {
    console.log("Not enough time to divide.");
    return;
  }

  const part = timeToDivide / 6;

  let intervals = [];
  for (let i = 1; i <= 6; i++) {
    intervals.push(Math.floor(i * part + 3));
  }
  console.log("Intervals (in seconds):", intervals);
  return intervals;
}

async function getDownloadUrl() {
  try {
    console.log("Fetching video download URL... == ", vimeoApiUrl);
    const response = await axios.get(vimeoApiUrl, {
      headers: {
        Authorization: `Bearer ${vimeoAccessToken}`,
      },
    });

    let renditionQuality = {};
    let downloadUrl;

    response.data.download.forEach((vid) => {
      renditionQuality[vid["rendition"]] = vid["link"];
    });

    const qualities = [
      "2160p",
      "1440p",
      "1080p",
      "720p",
      "540p",
      "480p",
      "360p",
      "240p",
      "180p",
    ];

    for (let quality of qualities) {
      if (renditionQuality[quality]) {
        downloadUrl = renditionQuality[quality];
        break;
      }
    }

    let vidDuration = response.data["duration"];
    let divideTimeDuration = divideTime(vidDuration);
    console.log(`Download URL fetched: ${downloadUrl}`);
    return { downloadUrl, divideTimeDuration };
  } catch (error) {
    console.error("Error fetching video download URL:", error.message);
    throw new Error("Error fetching video download URL: " + error.message);
  }
}

const downloadAndProcess = async () => {
  try {
    // Check if there are videos left to process
    if (processCount >= videos.length) {
      console.log("No more videos to process.");
    }

    console.log(
      `Starting download process for videoId: ${videoId} - ${videoTitle}`
    );

    const { downloadUrl, divideTimeDuration } = await getDownloadUrl();

    console.log(`Downloading video from URL: ${downloadUrl}`);

    const videoResponse = await axios.get(downloadUrl, {
      responseType: "stream",
    });

    const writer = fs.createWriteStream(outputFilePath);
    console.log(`Saving video to file: ${outputFilePath}`);

    videoResponse.data.pipe(writer);

    writer.on("finish", () => {
      console.log(`Video downloaded successfully. Extracting screenshots...`);
      ffmpeg(`./vid/${videoId}.mp4`)
        .on('progress', function (progress) {
          // console.log('progress :: timemark ' + progress.timemark);
          // console.log('progress :: frames ' + progress.frames);

        })
        .on('error', function (err) {
          console.log('An error occurred while taking SS: ' + err.message);
        })
        .on('end', async function () {
          console.log('Successfully generated');

          console.log("CURRENT VIDEO ID ", videoId);

          const screenshotsDir = path.join(__dirname, `./screenshots/${videoId}`);

          try {
            const screenshots = fs.readdirSync(screenshotsDir).map((file) =>
              path.join(screenshotsDir, file)
            );

            for (const screenshot of screenshots) {

              const fileName = path.basename(screenshot);

              console.log("Uploading File Name:", fileName);

              const formdata = new FormData();

              const fileStream = fs.createReadStream(screenshot);

              console.log('File stream type:', typeof fileStream);

              formdata.append("media", fileStream, fileName);

              const response = await axios.post(
                `http://209.182.232.11:5001/user-work/screenshot/${videoId}`,
                formdata,
                {
                  headers: {
                    "Content-Type": "multipart/form-data"
                  },
                }
              );

              console.log("Screenshot upload response:", response.data);

            }
          } catch (fsErr) {
            console.error("Error reading or uploading screenshots:", fsErr.message);
          }

          fs.unlink(`./vid/${videoId}.mp4`, (err) => {
            if (err) {
              console.error("Error deleting video file:", err.message);
            } else {
              console.log("Video file deleted successfully.");
            }
          });

          processCount += 1;
          console.log("processCount incremented to:", processCount);

          if (processCount < videos.length) {
            videoId = videos[processCount].videoID;
            videoTitle = videos[processCount].title;
            videoTitleModified = `${videoTitle.split(" ")[0]}_${videoTitle
              .split(" ")
              .pop()}`;
            outputFilePath = path.join(__dirname, `./vid/${videoId}.mp4`);
            vimeoApiUrl = `https://api.vimeo.com/videos/${videoId}`;

            console.log("Updated to next videoId:", videoId);
          } else {
            console.log("No more videos to process.");
          }

          console.log({
            message: "Video downloaded and saved successfully. Process count: " + processCount,
          });

        })
        .screenshot(
          {
            filename: videoId,
            count: 2,
            timemarks: divideTimeDuration,
          },
          `./screenshots/${videoId}`
        );

    });

    writer.on("error", (error) => {
      console.error("Error saving video:", error);
    });
  } catch (error) {
    console.error("Error during video download process:", error);
  }
};

cron.schedule("*/1 * * * *", downloadAndProcess);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
