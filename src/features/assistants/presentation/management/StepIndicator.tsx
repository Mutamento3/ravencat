import React from 'react';
import { View, Text } from 'react-native';
import { useThemedStyles } from '@shared/theme';
import { createStyles } from './styles';

interface StepIndicatorProps {
  currentStep: number;
  steps: string[];
}

/**
 * 步骤指示器组件
 */
export default function StepIndicator({ currentStep, steps }: StepIndicatorProps) {
  const styles = useThemedStyles(createStyles);

  const renderStep = (step: string, index: number) => {
    const stepNum = index + 1;
    const isActive = stepNum === currentStep;
    const isCompleted = stepNum < currentStep;

    return (
      <React.Fragment key={stepNum}>
        <View style={styles.stepItem}>
          <View style={[
            styles.stepCircle,
            isActive && styles.stepCircleActive,
            isCompleted && styles.stepCircleCompleted,
          ]}>
            <Text style={[
              styles.stepNumber,
              isActive && styles.stepNumberActive,
              isCompleted && styles.stepNumberCompleted,
            ]}>
              {stepNum}
            </Text>
          </View>
          <Text style={[
            styles.stepLabel,
            isActive && styles.stepLabelActive,
          ]}>
            {step}
          </Text>
        </View>
        {index < steps.length - 1 && (
          <View style={[
            styles.stepConnector,
            isCompleted && styles.stepConnectorCompleted,
          ]} />
        )}
      </React.Fragment>
    );
  };

  return (
    <View style={styles.stepIndicatorContainer}>
      {steps.map(renderStep)}
    </View>
  );
}
