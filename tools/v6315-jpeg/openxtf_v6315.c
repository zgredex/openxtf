#include <stdint.h>
#include <stddef.h>
#include <string.h>

#include "tjpgd.h"

typedef struct {
  const uint8_t *input;
  uint32_t input_length;
  uint32_t input_offset;
  uint8_t *output;
  uint32_t output_length;
  uint16_t output_width;
  uint16_t output_height;
  uint16_t ratio_numerator;
  uint16_t ratio_denominator;
} OpenXtfJpegSession;

static size_t openxtf_input(JDEC *decoder, uint8_t *buffer, size_t length) {
  OpenXtfJpegSession *session = (OpenXtfJpegSession *)decoder->device;
  uint32_t remaining = session->input_length - session->input_offset;
  if (length > remaining) length = remaining;
  if (buffer && length) {
    memcpy(buffer, session->input + session->input_offset, length);
  }
  session->input_offset += (uint32_t)length;
  return length;
}

static int openxtf_output(JDEC *decoder, void *bitmap, JRECT *rect) {
  OpenXtfJpegSession *session = (OpenXtfJpegSession *)decoder->device;
  const uint8_t *source = (const uint8_t *)bitmap;
  uint32_t source_width = (uint32_t)rect->right + 1U - rect->left;
  uint32_t source_height = (uint32_t)rect->bottom + 1U - rect->top;
  uint32_t numerator = session->ratio_numerator;
  uint32_t denominator = session->ratio_denominator;

  uint32_t output_left = numerator * rect->left / denominator;
  uint32_t output_top = numerator * rect->top / denominator;
  uint32_t output_width =
      numerator * ((uint32_t)rect->right + 1U) / denominator - output_left;
  uint32_t output_height =
      numerator * ((uint32_t)rect->bottom + 1U) / denominator - output_top;
  if (!output_width || !output_height) return 1;

  uint32_t source_y_accumulator = 0;
  for (uint32_t output_y = 0; output_y < output_height; ++output_y) {
    uint32_t source_y = source_y_accumulator / output_height;
    if (source_y >= source_height) source_y = source_height - 1U;
    uint32_t source_x_accumulator = 0;
    for (uint32_t output_x = 0; output_x < output_width; ++output_x) {
      uint32_t source_x = source_x_accumulator / output_width;
      if (source_x >= source_width) source_x = source_width - 1U;
      uint32_t target_x = output_left + output_x;
      uint32_t target_y = output_top + output_y;
      uint32_t target_index = target_y * session->output_width + target_x;
      if (target_x < session->output_width && target_y < session->output_height &&
          target_index < session->output_length) {
        session->output[target_index] = source[source_y * source_width + source_x];
      }
      source_x_accumulator += source_width;
    }
    source_y_accumulator += source_height;
  }
  return 1;
}

static uint8_t scale_exponent(uint32_t divisor) {
  if (divisor == 8U) return 3;
  if (divisor == 4U) return 2;
  return divisor == 2U ? 1 : 0;
}

int openxtf_v6315_jpeg_decode(
    const uint8_t *input,
    uint32_t input_length,
    uint16_t target_width,
    uint16_t target_height,
    uint32_t fit_by_width,
    uint8_t *output,
    uint32_t output_length,
    uint16_t *decoded_width,
    uint16_t *decoded_height) {
  if (!input || !input_length || !target_width || !target_height || !output ||
      output_length < (uint32_t)target_width * target_height) {
    return JDR_PAR;
  }

  uint8_t workspace[3500];
  JDEC decoder;
  OpenXtfJpegSession session = {
      input, input_length, 0, output, output_length,
      target_width, target_height, 1, 1};
  memset(output, 255, (uint32_t)target_width * target_height);
  JRESULT result =
      jd_prepare(&decoder, openxtf_input, workspace, sizeof(workspace), &session);
  if (result != JDR_OK) return result;

  uint32_t source_axis = fit_by_width ? decoder.width : decoder.height;
  uint32_t target_axis = fit_by_width ? target_width : target_height;
  uint32_t divisor = 1;
  if (source_axis > target_axis) {
    float ratio = (float)source_axis / (float)target_axis;
    if (ratio >= 8.0f) divisor = 8;
    else if (ratio >= 4.0f) divisor = 4;
    else if (ratio >= 2.0f) divisor = 2;
  }
  uint32_t denominator = source_axis / divisor;
  if (!denominator) denominator = 1;
  session.ratio_numerator = (uint16_t)target_axis;
  session.ratio_denominator = (uint16_t)denominator;
  if (decoded_width) {
    *decoded_width = fit_by_width
        ? target_width
        : (uint16_t)(((decoder.width / divisor) * target_height) / denominator);
  }
  if (decoded_height) {
    *decoded_height = fit_by_width
        ? (uint16_t)(((decoder.height / divisor) * target_width) / denominator)
        : target_height;
  }
  return jd_decomp(&decoder, openxtf_output, scale_exponent(divisor));
}
