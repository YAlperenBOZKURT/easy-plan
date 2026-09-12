import 'package:flutter/material.dart';

import '../accessibility.dart';
import '../localization.dart';
import '../store.dart';

Future<void> showAccessibilitySettings(
  BuildContext context, {
  required PlannerStore store,
}) => showDialog<void>(
  context: context,
  builder: (_) => _AccessibilityDialog(store: store),
);

class _AccessibilityDialog extends StatelessWidget {
  const _AccessibilityDialog({required this.store});

  final PlannerStore store;

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) => AlertDialog(
        title: Text(strings.text('accessibility.title')),
        content: SizedBox(
          width: 430,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<MotionPreference>(
                initialValue: store.motionPreference,
                decoration: InputDecoration(
                  labelText: strings.text('accessibility.motion'),
                ),
                items: [
                  for (final option in MotionPreference.values)
                    DropdownMenuItem(
                      value: option,
                      child: Text(strings.text('accessibility.motion.${option.name}')),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) store.setMotionPreference(value);
                },
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<TextDensity>(
                initialValue: store.textDensity,
                decoration: InputDecoration(
                  labelText: strings.text('accessibility.textDensity'),
                ),
                items: [
                  for (final option in TextDensity.values)
                    DropdownMenuItem(
                      value: option,
                      child: Text(strings.text('accessibility.density.${option.name}')),
                    ),
                ],
                onChanged: (value) {
                  if (value != null) store.setTextDensity(value);
                },
              ),
              const SizedBox(height: 12),
              Text(
                strings.text('accessibility.hint'),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(strings.text('common.close')),
          ),
        ],
      ),
    );
  }
}

