import type { AvatarSheetId } from '../appearance/classPresets';

export interface AvatarFrame { rect: readonly [number, number, number, number]; anchor: readonly [number, number] }
export interface AvatarClip { nativeHeight: number; front: readonly AvatarFrame[]; back: readonly AvatarFrame[] }
export interface AvatarSheet { file: string; width: number; height: number; presets: readonly AvatarClip[] }

// Independently measured alpha bounds and pivots of the original PNGs; no bitmap edits.
export const avatarSheets = {
  martial: {
    file: 'avatars-martial-v1.png', width: 1254, height: 1254,
    presets: [
      { nativeHeight: 304,
        front: [{"rect":[34,13,169,300],"anchor":[0.4906,0.9867]},{"rect":[248,14,141,294],"anchor":[0.4927,0.9864]},{"rect":[436,13,173,296],"anchor":[0.4811,0.9865]}],
        back: [{"rect":[662,9,195,304],"anchor":[0.4658,0.9901]},{"rect":[874,11,152,283],"anchor":[0.5341,0.9859]},{"rect":[1074,10,175,303],"anchor":[0.5273,0.9901]}] },
      { nativeHeight: 304,
        front: [{"rect":[30,322,173,304],"anchor":[0.4907,0.9868]},{"rect":[244,324,149,301],"anchor":[0.4691,0.9867]},{"rect":[437,324,168,297],"anchor":[0.4982,0.9865]}],
        back: [{"rect":[656,325,214,303],"anchor":[0.4105,0.9967]},{"rect":[879,325,154,290],"anchor":[0.5245,0.9862]},{"rect":[1074,327,176,301],"anchor":[0.4824,0.9867]}] },
      { nativeHeight: 303,
        front: [{"rect":[22,633,208,302],"anchor":[0.4435,0.9868]},{"rect":[236,631,144,301],"anchor":[0.5176,0.9867]},{"rect":[420,633,216,299],"anchor":[0.4496,0.9866]}],
        back: [{"rect":[661,637,198,303],"anchor":[0.4804,0.9868]},{"rect":[885,636,142,288],"anchor":[0.5204,0.9861]},{"rect":[1073,637,173,302],"anchor":[0.5565,0.9868]}] },
      { nativeHeight: 302,
        front: [{"rect":[11,947,198,297],"anchor":[0.5535,0.9865]},{"rect":[243,947,145,294],"anchor":[0.4855,0.9864]},{"rect":[420,947,188,294],"anchor":[0.5485,0.9864]}],
        back: [{"rect":[659,946,186,299],"anchor":[0.5399,0.9866]},{"rect":[892,946,142,283],"anchor":[0.4872,0.9859]},{"rect":[1070,943,165,302],"anchor":[0.5694,0.9868]}] },
    ],
  },
  arcane: {
    file: 'avatars-arcane-v1.png', width: 1254, height: 1254,
    presets: [
      { nativeHeight: 306,
        front: [{"rect":[13,6,207,304],"anchor":[0.6178,0.9868]},{"rect":[238,5,162,305],"anchor":[0.514,0.9869]},{"rect":[418,5,198,305],"anchor":[0.5901,0.9869]}],
        back: [{"rect":[648,4,190,306],"anchor":[0.608,0.9869]},{"rect":[872,5,150,302],"anchor":[0.5279,0.9868]},{"rect":[1055,5,182,304],"anchor":[0.5684,0.9868]}] },
      { nativeHeight: 309,
        front: [{"rect":[18,313,178,308],"anchor":[0.6189,0.987]},{"rect":[238,313,131,306],"anchor":[0.4966,0.9869]},{"rect":[414,313,170,309],"anchor":[0.6007,0.9871]}],
        back: [{"rect":[646,313,170,309],"anchor":[0.5771,0.9871]},{"rect":[872,313,140,299],"anchor":[0.5151,0.9866]},{"rect":[1061,313,154,309],"anchor":[0.5354,0.9871]}] },
      { nativeHeight: 301,
        front: [{"rect":[15,627,191,301],"anchor":[0.5862,0.9867]},{"rect":[232,627,150,297],"anchor":[0.4888,0.9865]},{"rect":[413,627,186,298],"anchor":[0.5658,0.9866]}],
        back: [{"rect":[643,627,183,301],"anchor":[0.5733,0.99]},{"rect":[870,627,137,291],"anchor":[0.5207,0.9863]},{"rect":[1050,627,179,298],"anchor":[0.5078,0.9866]}] },
      { nativeHeight: 311,
        front: [{"rect":[21,928,179,308],"anchor":[0.5903,0.987]},{"rect":[239,928,132,304],"anchor":[0.5006,0.9868]},{"rect":[411,928,183,308],"anchor":[0.5882,0.987]}],
        back: [{"rect":[645,930,172,311],"anchor":[0.5853,0.9871]},{"rect":[871,930,134,298],"anchor":[0.5259,0.9866]},{"rect":[1051,931,160,308],"anchor":[0.5567,0.987]}] },
    ],
  },
  primal: {
    file: 'avatars-primal-v1.png', width: 1254, height: 1254,
    presets: [
      { nativeHeight: 302,
        front: [{"rect":[19,18,197,287],"anchor":[0.5526,0.9861]},{"rect":[235,18,175,279],"anchor":[0.5189,0.9857]},{"rect":[418,21,202,280],"anchor":[0.5553,0.9857]}],
        back: [{"rect":[658,3,184,298],"anchor":[0.6151,0.9866]},{"rect":[881,10,164,279],"anchor":[0.5556,0.9857]},{"rect":[1063,2,182,302],"anchor":[0.6213,0.9868]}] },
      { nativeHeight: 302,
        front: [{"rect":[15,308,165,302],"anchor":[0.5416,0.9868]},{"rect":[232,308,136,297],"anchor":[0.5065,0.9865]},{"rect":[416,311,165,297],"anchor":[0.5731,0.9865]}],
        back: [{"rect":[661,309,174,300],"anchor":[0.5305,0.9867]},{"rect":[889,308,135,291],"anchor":[0.5144,0.9863]},{"rect":[1073,311,166,299],"anchor":[0.5124,0.9866]}] },
      { nativeHeight: 314,
        front: [{"rect":[21,612,157,313],"anchor":[0.5056,0.9968]},{"rect":[238,611,132,314],"anchor":[0.5092,0.9968]},{"rect":[424,611,165,314],"anchor":[0.4922,0.9904]}],
        back: [{"rect":[666,613,161,312],"anchor":[0.4858,0.9968]},{"rect":[894,612,134,310],"anchor":[0.4719,0.9871]},{"rect":[1092,614,150,311],"anchor":[0.4896,0.9968]}] },
      { nativeHeight: 312,
        front: [{"rect":[16,925,148,304],"anchor":[0.5841,0.9868]},{"rect":[240,925,129,304],"anchor":[0.5445,0.9868]},{"rect":[418,925,160,305],"anchor":[0.6184,0.9869]}],
        back: [{"rect":[667,925,161,311],"anchor":[0.5607,0.9871]},{"rect":[900,925,117,300],"anchor":[0.5275,0.9867]},{"rect":[1079,925,151,312],"anchor":[0.4988,0.9872]}] },
    ],
  },
  traveler: {
    file: 'avatars-traveler-v1.png', width: 1536, height: 1024,
    presets: [
      { nativeHeight: 474,
        front: [{"rect":[249,20,203,472],"anchor":[0.5268,0.9915]},{"rect":[692,19,154,474],"anchor":[0.5225,0.9916]},{"rect":[1088,21,216,472],"anchor":[0.4895,0.9915]}],
        back: [{"rect":[249,516,218,451],"anchor":[0.4939,0.9911]},{"rect":[687,518,162,442],"anchor":[0.4761,0.991]},{"rect":[1092,521,222,454],"anchor":[0.4713,0.9912]}] },
    ],
  },
} satisfies Record<AvatarSheetId, AvatarSheet>;
