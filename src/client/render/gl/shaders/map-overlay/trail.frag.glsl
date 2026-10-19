#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTrailTex;     // R16UI — trail texel: owner smallID (bits 0-11)
                                  //   + nuke bit (bit 12); 0 = no trail
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uAffiliation;  // RGBA8 — affiliation colors (row 0 = border, row 1 = unit)
uniform sampler2D  uEffect;       // RGBA32F — trail effect, keyed by ownerID. Stacked blocks
                                  //   of MAX_TRAIL_COLORS rows: block 0 = transportShipTrail,
                                  //   block 1 = nukeTrail. Within a block (rowBase = block start):
                                  //   row r = color r's rgb; spare alphas hold scalars:
                                  //   row 0.a = color count (0 = no effect → territory color),
                                  //   row 1.a = styleId (0 = gradient, 1 = transition, 2 = spiral,
                                  //            3 = dashed, 4 = sparkle, 5 = pulse),
                                  //   row 2.a = scalar0 (gradient colorSize / transition freq),
                                  //   row 3.a = scalar1 (gradient movementSpeed)
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform float uTime;              // seconds, for animated effect styles
uniform int uAltView;

in vec2 vWorldPos;
out vec4 fragColor;

// Cheap per-tile hash in [0,1), for the sparkle style.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 effectColor(int o, int rowBase, int i) {
  return texelFetch(uEffect, ivec2(o, rowBase + i), 0).rgb;
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint trailVal = texelFetch(uTrailTex, tc, 0).r;
  uint owner = trailVal & 0xFFFu;       // bits 0-11 = owner smallID
  if (owner == 0u) discard;
  uint isNuke = (trailVal >> 12) & 1u;  // bit 12 = nuke trail

  vec3 color;
  if (uAltView != 0) {
    // Alt view recolors everything by affiliation — effects stay off so the
    // strategic overlay reads consistently.
    color = texelFetch(uAffiliation, ivec2(int(owner), 1), 0).rgb;
  } else {
    int o = int(owner);
    // Boat trails read block 0; nuke trails read block 1 (rows offset by
    // MAX_TRAIL_COLORS). The effect attributes are otherwise identical.
    int rowBase = isNuke == 1u ? MAX_TRAIL_COLORS : 0;
    int count = int(texelFetch(uEffect, ivec2(o, rowBase), 0).a + 0.5);
    int styleId = int(texelFetch(uEffect, ivec2(o, rowBase + 1), 0).a + 0.5);
    float s0 = texelFetch(uEffect, ivec2(o, rowBase + 2), 0).a;
    float s1 = texelFetch(uEffect, ivec2(o, rowBase + 3), 0).a;
    float along = vWorldPos.x + vWorldPos.y;
    if (count > 0 && styleId == 3) {
      // dashed — gaps every other dash, dashes march along the trail and
      // step through the color list.
      float dash = max(s0, 0.5);
      float k = (along - uTime * s1) / dash;
      if (mod(floor(k), 2.0) > 0.5) discard;
      int i = int(mod(floor(k * 0.5), float(count)));
      fragColor = vec4(effectColor(o, rowBase, i), uTrailAlpha);
      return;
    } else if (count > 0 && styleId == 4) {
      // sparkle — only a twinkling share of tiles is lit, each a random
      // color from the list, brightest at the start of its twinkle.
      float tw = floor(uTime * max(s1, 0.0));
      float h = hash12(vec2(tc) + tw * 17.0);
      if (h > s0) discard;
      int i = int(hash12(vec2(tc) * 1.7 + tw) * float(count)) % count;
      float glow = 0.6 + 0.4 * (1.0 - fract(uTime * max(s1, 0.0)));
      fragColor = vec4(effectColor(o, rowBase, i) * glow, uTrailAlpha);
      return;
    } else if (count > 0 && styleId == 5) {
      // pulse — short bright pulses race along a dim trail.
      float len = max(s0, 1.0);
      float cycle = len * 4.0;
      float phase = fract((along - uTime * s1) / cycle);
      float bright = smoothstep(0.0, 0.08, phase) *
        (1.0 - smoothstep(0.25, 0.3, phase));
      int i = int(mod(floor((along - uTime * s1) / cycle), float(count)));
      vec3 c = effectColor(o, rowBase, i);
      fragColor = vec4(mix(c * 0.3, c, bright), uTrailAlpha * (0.45 + 0.55 * bright));
      return;
    }
    if (count <= 0) {
      // No effect — fall back to the player's territory color.
      float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
      color = texture(uPalette, vec2(u, 0.25)).rgb;
    } else if (count == 1) {
      // Single color — flat trail.
      color = texelFetch(uEffect, ivec2(o, rowBase), 0).rgb;
    } else if (int(texelFetch(uEffect, ivec2(o, rowBase + 1), 0).a + 0.5) == 2) {
      // spiral — the vortex itself renders as ribbon geometry above this
      // pass (SpiralRibbonPass); the stamped centerline underneath draws
      // flat in the first color, as the missile's spine.
      color = texelFetch(uEffect, ivec2(o, rowBase), 0).rgb;
    } else if (int(texelFetch(uEffect, ivec2(o, rowBase + 1), 0).a + 0.5) == 1) {
      // transition — the whole trail is one color at a time, cross-fading
      // through the list over time. frequency = color changes per second.
      float frequency = texelFetch(uEffect, ivec2(o, rowBase + 2), 0).a;
      float t = uTime * frequency;
      int i = int(t) % count;
      int j = (i + 1) % count;
      vec3 a = texelFetch(uEffect, ivec2(o, rowBase + i), 0).rgb;
      vec3 b = texelFetch(uEffect, ivec2(o, rowBase + j), 0).rgb;
      color = mix(a, b, fract(t));
    } else {
      // gradient — cyclic gradient banded across the map (world-space diagonal),
      // scrolling over time so a moving trail shifts hue along it. colorSize
      // = band width in tiles; movementSpeed = tiles/sec the bands travel.
      float colorSize = max(texelFetch(uEffect, ivec2(o, rowBase + 2), 0).a, 0.001);
      float movementSpeed = texelFetch(uEffect, ivec2(o, rowBase + 3), 0).a;
      float cycle = colorSize * float(count);
      float phase =
        fract((vWorldPos.x + vWorldPos.y - uTime * movementSpeed) / cycle);
      float f = phase * float(count);
      int i = int(f) % count;
      int j = (i + 1) % count;
      vec3 a = texelFetch(uEffect, ivec2(o, rowBase + i), 0).rgb;
      vec3 b = texelFetch(uEffect, ivec2(o, rowBase + j), 0).rgb;
      color = mix(a, b, fract(f));
    }
  }
  fragColor = vec4(color, uTrailAlpha);
}
