enum MotionPreference { system, reduce, full }

enum TextDensity { compact, standard, comfortable }

MotionPreference motionPreferenceFromStorage(String? value) => switch (value) {
  'reduce' => MotionPreference.reduce,
  'full' => MotionPreference.full,
  _ => MotionPreference.system,
};

TextDensity textDensityFromStorage(String? value) => switch (value) {
  'compact' => TextDensity.compact,
  'comfortable' => TextDensity.comfortable,
  _ => TextDensity.standard,
};

extension MotionPreferenceValue on MotionPreference {
  String get storageValue => name;

  bool resolve({required bool systemReducedMotion}) => switch (this) {
    MotionPreference.system => systemReducedMotion,
    MotionPreference.reduce => true,
    MotionPreference.full => false,
  };
}

extension TextDensityValue on TextDensity {
  String get storageValue => name;

  double get scaleFactor => switch (this) {
    TextDensity.compact => .9,
    TextDensity.standard => 1,
    TextDensity.comfortable => 1.15,
  };
}

